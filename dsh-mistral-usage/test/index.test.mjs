/**
 * Checks for the Mistral usage bundle.
 *
 * The pure helpers are exercised directly; the two integration points that
 * matter are covered too: the billing normalization the panel reads, and the
 * `dsh-cost-meter` provider entry this bundle installs.
 *
 * Run with `node --test test/index.test.mjs`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(here)

/** Load the Host half once. */
const host = await import(path.join(root, 'index.js'))
const { __test } = host

/**
 * A billing body shaped like `GET /v1/billing/budget`.
 * @returns {object} the body.
 */
function budgetBody() {
  return {
    vibe_budget: { initial_budget: 127.5, usage_percentage: 12.5, currency: 'EUR', reset_at: '2026-12-01T00:00:00Z', payg_enabled: false },
    api_budget: { initial_budget: 50, usage_percentage: 40, currency: 'EUR', reset_at: '2026-12-01T00:00:00Z', payg_enabled: true },
  }
}

test('a budget becomes a spend view with the reported percentage', () => {
  const vibe = __test.normalizeBudget(budgetBody().vibe_budget, 'vibe')
  assert.equal(vibe.limit, 127.5)
  assert.equal(vibe.percent, 12.5)
  assert.equal(vibe.spent, 15.9375)
  assert.equal(vibe.currency, 'EUR')
  assert.equal(vibe.resetAt, '2026-12-01T00:00:00Z')
})

test('a budget without a positive limit is not a budget', () => {
  assert.equal(__test.normalizeBudget({ initial_budget: 0, usage_percentage: 10 }, 'vibe'), undefined)
  assert.equal(__test.normalizeBudget({ usage_percentage: 10 }, 'vibe'), undefined)
  assert.equal(__test.normalizeBudget(undefined, 'vibe'), undefined)
})

test('both billing answers fold into one view led by the Vibe allowance', () => {
  const view = __test.normalizeBilling({ plan_name: 'EDU', payg_enabled: false }, budgetBody(), 'EUR')
  assert.equal(view.plan, 'EDU')
  assert.equal(view.currency, 'EUR')
  assert.equal(view.percent, 12.5)
  assert.equal(view.limit, 127.5)
  assert.equal(view.remaining, 111.5625)
  assert.equal(view.api.percent, 40)
  assert.equal(view.api.payg, true)
})

test('neither answer carrying data yields no view', () => {
  assert.equal(__test.normalizeBilling(undefined, undefined, 'EUR'), undefined)
  assert.equal(__test.normalizeBilling({}, {}, 'EUR'), undefined)
})

test('a refused key is reported with the API detail', () => {
  assert.equal(__test.refusalReason(401, { detail: 'Unauthorized' }), 'Unauthorized')
  assert.equal(__test.refusalReason(403, { message: 'forbidden' }), 'forbidden')
  assert.equal(__test.refusalReason(403, undefined), 'HTTP 403')
  assert.equal(__test.refusalReason(200, { ok: true }), undefined)
})

test('the day key is the local calendar day', () => {
  const at = new Date(2026, 10, 7, 23, 30).getTime()
  assert.equal(__test.dayKey(at), '2026-11-07')
})

test('a session log folds Mistral usage by day and model, ignoring other providers', () => {
  const now = Date.now()
  const lines = [
    JSON.stringify({
      type: 'assistant/message',
      time: now - 1000,
      data: { usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 5000 }, message: { source: { provider: 'mistral', model: 'deepseek-v4-1-flash-1017' } } },
    }),
    JSON.stringify({
      type: 'assistant/message',
      time: now - 500,
      data: { usage: { inputTokens: 10, outputTokens: 1 }, message: { source: { provider: 'deepseek', model: 'deepseek-v4' } } },
    }),
    JSON.stringify({
      type: 'assistant/message',
      time: now + 10_000,
      data: { usage: { inputTokens: 999, outputTokens: 999 }, message: { source: { provider: 'mistral', model: 'x' } } },
    }),
  ]
  const fold = __test.foldSession(lines.join('\n'), now)
  const day = fold.days[__test.dayKey(now - 1000)]
  assert.equal(day.calls, 1)
  assert.equal(day.input, 1000)
  assert.equal(day.output, 100)
  assert.equal(day.cacheRead, 5000)
  // The event after the cutoff belongs to the live ledger, not the history.
  assert.equal(Object.values(fold.days).reduce((sum, entry) => sum + entry.calls, 0), 1)
})

test('merging folds keeps every counter', () => {
  const target = {}
  __test.mergeDays(target, { '2026-11-07': { calls: 1, input: 10, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, byModel: { m: { calls: 1, input: 10, output: 1, cacheRead: 0, cacheWrite: 0 } } } })
  __test.mergeDays(target, { '2026-11-07': { calls: 2, input: 20, output: 2, cacheRead: 5, cacheWrite: 0, reasoning: 0, byModel: { m: { calls: 2, input: 20, output: 2, cacheRead: 5, cacheWrite: 0 } } } })
  assert.equal(target['2026-11-07'].calls, 3)
  assert.equal(target['2026-11-07'].input, 30)
  assert.equal(target['2026-11-07'].cacheRead, 5)
  assert.equal(target['2026-11-07'].byModel.m.calls, 3)
})

test('the quota answer carries only the window fields the cost meter renders', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(budgetBody()), { status: 200 })
  try {
    const answer = await __test.queryMistralQuota('sk-test', 'https://api.mistral.ai', 1000)
    assert.deepEqual(Object.keys(answer.windows).sort(), ['api', 'balance', 'monthly'])
    for (const window of Object.values(answer.windows)) {
      for (const key of Object.keys(window)) assert.ok(['percent', 'resetsAt', 'text'].includes(key), `unexpected field ${key}`)
    }
    assert.equal(answer.windows.monthly.percent, 12.5)
    assert.equal(answer.windows.monthly.resetsAt, '2026-12-01T00:00:00Z')
    assert.equal(answer.windows.api.percent, 40)
    assert.match(answer.windows.balance.text, /111/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a refused key is a soft failure, not a zero', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 })
  try {
    await assert.rejects(() => __test.queryMistralQuota('bad', 'https://api.mistral.ai', 1000), (error) => {
      assert.equal(error.soft, true)
      assert.match(error.message, /401/)
      return true
    })
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a body without an allowance is an error, not an empty card', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200 })
  try {
    await assert.rejects(() => __test.queryMistralQuota('sk', 'https://api.mistral.ai', 1000), /no allowance/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the cost-meter provider is installed and removed without touching disk', async (t) => {
  // Anchor the resolution on a throwaway profile that links the real package.
  const installed = path.join(process.env.DSH_PROFILE_DIR ?? '', 'node_modules', 'dsh-cost-meter')
  if (!fs.existsSync(installed)) {
    t.skip('dsh-cost-meter is not installed in this profile')
    return
  }
  // That package imports Harness services that only exist inside the app, so
  // the module is only loadable there; outside it the check cannot run.
  const loadable = await import(pathToFileURL(path.join(installed, 'lib', 'coding-plans.js')).href).then(
    () => true,
    () => false,
  )
  if (!loadable) {
    t.skip('dsh-cost-meter needs Harness services that a plain Node process does not provide')
    return
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-usage-test-'))
  const profileDir = path.join(home, 'profiles', 'desktop')
  fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(profileDir, 'package.json'), '{"name":"dsh-profile-desktop","private":true}')
  fs.symlinkSync(installed, path.join(profileDir, 'node_modules', 'dsh-cost-meter'), 'dir')
  const previousHome = process.env.DSH_HOME
  const previousProfile = process.env.DSH_PROFILE
  process.env.DSH_HOME = home
  process.env.DSH_PROFILE = 'desktop'
  try {
    const moduleUrl = await __test.resolveCostMeterModule()
    assert.ok(typeof moduleUrl === 'string', 'the cost meter module resolves')
    const costMeter = await import(moduleUrl)
    const dispose = await __test.installCostMeterProvider({ logger: { info() {}, warn() {} } })
    assert.equal(typeof dispose, 'function')
    assert.ok(__test.COST_METER_PROVIDER in costMeter.CODING_PLAN_PROVIDERS)
    assert.ok(costMeter.CODING_PLAN_PROVIDER_IDS.includes(__test.COST_METER_PROVIDER))
    assert.equal(costMeter.CODING_PLAN_PROVIDERS[__test.COST_METER_PROVIDER].label, 'Mistral')
    dispose()
    assert.ok(!(__test.COST_METER_PROVIDER in costMeter.CODING_PLAN_PROVIDERS))
    assert.ok(!costMeter.CODING_PLAN_PROVIDER_IDS.includes(__test.COST_METER_PROVIDER))
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousProfile === undefined) delete process.env.DSH_PROFILE
    else process.env.DSH_PROFILE = previousProfile
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('the bundle manifest and patch agree', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@local/dsh-mistral-usage')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`)
  }
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: mistral-usage/)
  assert.match(patch, /name: '@local\/dsh-mistral-usage'/)
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'en.json'), 'utf8'))
  assert.ok(zh.meta.title.length > 0 && en.meta.title.length > 0)
  assert.ok(zh.meta.description.length > 0 && en.meta.description.length > 0)
})
