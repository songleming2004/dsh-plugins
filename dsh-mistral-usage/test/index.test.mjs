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
    // The API budget is the only allowance this key spends; `monthly` carries it.
    assert.deepEqual(Object.keys(answer.windows).sort(), ['balance', 'monthly'])
    for (const window of Object.values(answer.windows)) {
      for (const key of Object.keys(window)) assert.ok(['percent', 'resetsAt', 'text'].includes(key), `unexpected field ${key}`)
    }
    assert.equal(answer.windows.monthly.percent, 40)
    assert.equal(answer.windows.monthly.resetsAt, '2026-12-01T00:00:00Z')
    assert.match(answer.windows.balance.text, /30/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the Vibe allowance is never reported as this key\'s spend', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(budgetBody()), { status: 200 })
  try {
    const answer = await __test.queryMistralQuota('sk-test', 'https://api.mistral.ai', 1000)
    // budgetBody's Vibe budget is 12.5% of 127.5; the API budget is 40% of 50.
    assert.notEqual(answer.windows.monthly.percent, 12.5)
    assert.equal(answer.windows.monthly.percent, 40)
    assert.match(answer.windows.balance.text, /30/)
    assert.doesNotMatch(answer.windows.balance.text, /111/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a key with no API budget is an error even when a Vibe allowance exists', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    vibe_budget: { initial_budget: 127.5, usage_percentage: 12.5, currency: 'EUR' },
  }), { status: 200 })
  try {
    await assert.rejects(() => __test.queryMistralQuota('sk', 'https://api.mistral.ai', 1000), /no API budget/)
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
    await assert.rejects(() => __test.queryMistralQuota('sk', 'https://api.mistral.ai', 1000), /no API budget/)
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

test('the view never hands the Vibe allowance to a surface', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(budgetBody()), { status: 200 })
  try {
    const view = new __test.MistralUsage({
      // A credential seam that hands back the key, as the Host's own does.
      ctx: { get: (name) => (name === 'credentials' ? { resolve: async () => ({ value: 'sk-test', source: 'file' }) } : undefined) },
      apiKeyEnv: 'MISTRAL_API_KEY',
      baseURL: 'https://api.mistral.ai',
      currency: 'EUR',
      barMax: 125,
      requestTimeoutMs: 1000,
      costMeter: false,
      logger: { warn() {}, info() {}, debug() {} },
    })
    view.seeded = true
    const pricesFor = () => ({ prices: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, source: 'test' })
    const answer = await view.view({ refresh: true }, pricesFor)
    assert.equal(answer.provider, 'mistral')
    assert.equal(answer.bar.budget, 'api')
    assert.equal(answer.bar.max, 50)
    assert.equal(answer.consumption.api.percent, 40)
    assert.equal(answer.consumption.vibe, undefined)
    // The flat fields now describe the API budget, not the Vibe allowance.
    assert.equal(answer.consumption.limit, 50)
    assert.equal(answer.consumption.percent, 40)
  } finally {
    globalThis.fetch = realFetch
  }
})

// #region Magpie

/** A Magpie quotas body shaped like `GET /v1/magpie/quotas`. */
function magpieQuotasBody() {
  return {
    data: [
      {
        provider: 'mistral',
        name: 'Mistral',
        kind: 'plan',
        plan: 'Student',
        windows: [{ name: 'API · Month', used: 16.2, remaining: 83.8, resetsAt: '2026-12-01T00:00:00Z', amount: 2.43, limit: 15, unit: 'USD' }],
        readAt: '2026-11-08T21:00:44-06:00',
      },
      {
        provider: 'mistral-vibe',
        name: 'Mistral Vibe',
        kind: 'plan',
        plan: 'Student',
        windows: [{ name: 'Month', used: 0.08, remaining: 99.92, resetsAt: '2026-12-01T00:00:00Z', amount: 0.12, limit: 150, unit: 'USD' }],
        last: true,
      },
    ],
    object: 'list',
  }
}

/** A Magpie usage body shaped like `GET /v1/magpie/usage?period=30d`. */
function magpieUsageBody() {
  return {
    period: '30d',
    since: '2026-10-10T00:00:00-05:00',
    bucket: 'day',
    calls: 12,
    errors: 1,
    input: 1000,
    output: 200,
    cache_read: 5000,
    cache_write: 0,
    reasoning: 0,
    cost: 0.25,
    unpriced: 0,
    sessionCount: 3,
    path: '~/.config/magpie/usage.jsonl',
    series: [
      { label: 'Nov 7', time: '2026-11-07T00:00:00-06:00', calls: 2, input: 100, output: 20, cache_read: 0, cache_write: 0, cost: 0.01 },
      { label: 'Nov 8', time: '2026-11-08T00:00:00-06:00', calls: 10, input: 900, output: 180, cache_read: 5000, cache_write: 0, cost: 0.24 },
    ],
    models: [{ id: 'mistral-vibe/deepseek-v4-1-flash-1017', provider: 'mistral-vibe', model: 'deepseek-v4-1-flash-1017', calls: 12, input: 1000, output: 200, cache_read: 5000, cache_write: 0, cost: 0.25 }],
    agents: [{ id: 'dsh', name: 'DeepSeek Harness', calls: 12, input: 1000, output: 200, cache_read: 5000, cache_write: 0, cost: 0.25 }],
  }
}

test('a model route maps to the provider that reports it', () => {
  // The Magpie gateway is a provider row named `magpie`, so a session on it is
  // Magpie's traffic even when the model behind it is Mistral's.
  assert.equal(__test.providerOfRoute('magpie'), 'magpie')
  assert.equal(__test.providerOfRoute('Magpie'), 'magpie')
  assert.equal(__test.providerOfRoute('mistral'), 'mistral')
  assert.equal(__test.providerOfRoute('mistral-vibe'), 'mistral')
  assert.equal(__test.providerOfRoute('deepseek'), undefined)
  assert.equal(__test.providerOfRoute(undefined), undefined)
})

test('a requested provider and period are coerced to the accepted set', () => {
  assert.equal(__test.normalizeProvider('magpie'), 'magpie')
  assert.equal(__test.normalizeProvider('MISTRAL'), 'mistral')
  assert.equal(__test.normalizeProvider('openai'), undefined)
  assert.equal(__test.normalizeMagpiePeriod('today'), 'today')
  assert.equal(__test.normalizeMagpiePeriod('7d'), '7d')
  // The gateway answers 30d for anything it does not know, so ask for it.
  assert.equal(__test.normalizeMagpiePeriod('90d'), '30d')
  assert.equal(__test.normalizeMagpiePeriod(undefined), '30d')
})

test('a Magpie window carries its percentage and money', () => {
  const window = __test.normalizeMagpieWindow({ name: 'API · Month', used: 16.2, remaining: 83.8, amount: 2.43, limit: 15, unit: 'USD', resetsAt: '2026-12-01T00:00:00Z' })
  assert.equal(window.name, 'API · Month')
  assert.equal(window.percent, 16.2)
  assert.equal(window.spent, 2.43)
  assert.equal(window.limit, 15)
  assert.equal(window.remaining, 83.8)
  assert.equal(window.currency, 'USD')
  assert.equal(window.resetAt, '2026-12-01T00:00:00Z')
  assert.equal(__test.normalizeMagpieWindow(undefined), undefined)
})

test('Magpie quotas normalize into subscriptions with their windows', () => {
  const view = __test.normalizeMagpieQuotas(magpieQuotasBody())
  assert.equal(view.subscriptions.length, 2)
  assert.equal(view.subscriptions[0].provider, 'mistral')
  assert.equal(view.subscriptions[0].plan, 'Student')
  assert.equal(view.subscriptions[0].windows[0].percent, 16.2)
  assert.equal(view.subscriptions[1].last, true)
  assert.equal(__test.normalizeMagpieQuotas({ data: [] }), undefined)
  assert.equal(__test.normalizeMagpieQuotas({}), undefined)
})

test('Magpie usage normalizes into the ledger shape the panel renders', () => {
  const ledger = __test.normalizeMagpieUsage(magpieUsageBody())
  assert.equal(ledger.period, '30d')
  assert.equal(ledger.total.calls, 12)
  assert.equal(ledger.total.cacheRead, 5000)
  assert.equal(ledger.total.cost, 0.25)
  assert.equal(ledger.byModel[0].model, 'mistral-vibe/deepseek-v4-1-flash-1017')
  assert.equal(ledger.byModel[0].priceSource, 'magpie')
  assert.equal(ledger.series.length, 2)
  // The newest bucket stands in for today, so the card keeps its two rows.
  assert.equal(ledger.today.label, 'Nov 8')
  assert.equal(ledger.today.calls, 10)
  assert.equal(ledger.agents[0].name, 'DeepSeek Harness')
  assert.equal(ledger.sessionCount, 3)
  assert.equal(__test.normalizeMagpieUsage(undefined), undefined)
})

test('the Magpie view reads the gateway and leads with the served subscription', async () => {
  const realFetch = globalThis.fetch
  const asked = []
  globalThis.fetch = async (url) => {
    asked.push(String(url))
    if (String(url).includes('/v1/magpie/quotas')) return new Response(JSON.stringify(magpieQuotasBody()), { status: 200 })
    return new Response(JSON.stringify(magpieUsageBody()), { status: 200 })
  }
  try {
    const view = new __test.MistralUsage({
      ctx: { get: () => undefined },
      apiKeyEnv: 'MISTRAL_API_KEY',
      baseURL: 'https://api.mistral.ai',
      currency: 'EUR',
      barMax: 125,
      requestTimeoutMs: 1000,
      costMeter: false,
      magpieBaseURL: 'http://127.0.0.1:3425',
      magpieKeyEnv: 'MAGPIE_GATEWAY_KEY',
      logger: { warn() {}, info() {}, debug() {} },
    })
    const answer = await view.view({ provider: 'magpie', period: '30d' }, () => ({ prices: {}, source: 'test' }))
    assert.equal(answer.provider, 'magpie')
    assert.equal(answer.status, 'ok')
    // The subscription Magpie served last leads the card.
    assert.equal(answer.subscription, 'mistral-vibe')
    assert.equal(answer.plan, 'Student')
    assert.equal(answer.bar.percent, 0.08)
    assert.equal(answer.bar.max, 150)
    assert.equal(answer.usage.total.calls, 12)
    assert.ok(asked.some((url) => url.endsWith('/v1/magpie/usage?period=30d')), 'the usage window is asked for')
    assert.ok(asked.every((url) => url.startsWith('http://127.0.0.1:3425')), 'only the gateway is asked')
    // The Mistral billing API is never touched for a Magpie view.
    assert.ok(!asked.some((url) => url.includes('api.mistral.ai')), 'the vendor is not asked')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a gateway that is not running is reported, not thrown', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3425')
  }
  try {
    const view = new __test.MistralUsage({
      ctx: { get: () => undefined },
      apiKeyEnv: 'MISTRAL_API_KEY',
      baseURL: 'https://api.mistral.ai',
      currency: 'EUR',
      barMax: 125,
      requestTimeoutMs: 1000,
      costMeter: false,
      logger: { warn() {}, info() {}, debug() {} },
    })
    const answer = await view.view({ provider: 'magpie' }, () => ({ prices: {}, source: 'test' }))
    assert.equal(answer.status, 'unreachable')
    assert.match(answer.message, /not answering/)
    assert.equal(answer.subscriptions.length, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the view follows the session route until a provider is asked for', async () => {
  const realFetch = globalThis.fetch
  const asked = []
  globalThis.fetch = async (url) => {
    asked.push(String(url))
    if (String(url).includes('/v1/magpie/quotas')) return new Response(JSON.stringify(magpieQuotasBody()), { status: 200 })
    if (String(url).includes('/v1/magpie/usage')) return new Response(JSON.stringify(magpieUsageBody()), { status: 200 })
    return new Response(JSON.stringify(budgetBody()), { status: 200 })
  }
  try {
    const view = new __test.MistralUsage({
      ctx: { get: (name) => (name === 'credentials' ? { resolve: async () => ({ value: 'sk-test', source: 'file' }) } : undefined) },
      apiKeyEnv: 'MISTRAL_API_KEY',
      baseURL: 'https://api.mistral.ai',
      currency: 'EUR',
      barMax: 125,
      requestTimeoutMs: 1000,
      costMeter: false,
      logger: { warn() {}, info() {}, debug() {} },
    })
    view.seeded = true
    const pricesFor = () => ({ prices: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, source: 'test' })
    // Nothing seen yet: the bundle's original subject leads.
    assert.equal(view.providerFor('s1'), undefined)
    const first = await view.view({ sessionId: 's1' }, pricesFor)
    assert.equal(first.provider, 'mistral')
    assert.equal(first.followed, null)
    // A Magpie-routed call moves the session, and the next view follows it.
    view.observeRoute('s1', 'magpie')
    const second = await view.view({ sessionId: 's1' }, pricesFor)
    assert.equal(second.provider, 'magpie')
    assert.equal(second.followed, 'magpie')
    // Another session is unaffected.
    view.observeRoute('s2', 'mistral')
    assert.equal((await view.view({ sessionId: 's2' }, pricesFor)).provider, 'mistral')
    // An explicit request still wins over the route.
    assert.equal((await view.view({ sessionId: 's2', provider: 'magpie' }, pricesFor)).provider, 'magpie')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a Magpie-routed call is not folded into the local Mistral ledger', () => {
  // Magpie reports its own traffic, so folding it here would count the same
  // call twice across the two views.
  const now = Date.now()
  const lines = [
    JSON.stringify({
      type: 'assistant/message',
      time: now - 1000,
      data: { usage: { inputTokens: 1000, outputTokens: 100 }, message: { source: { provider: 'magpie', model: 'mistral-vibe/deepseek-v4-1-flash-1017' } } },
    }),
    JSON.stringify({
      type: 'assistant/message',
      time: now - 900,
      data: { usage: { inputTokens: 10, outputTokens: 1 }, message: { source: { provider: 'mistral', model: 'deepseek-v4-1-flash-1017' } } },
    }),
  ]
  const fold = __test.foldSession(lines.join('\n'), now + 10_000)
  const day = fold.days[__test.dayKey(now - 1000)]
  assert.equal(day.calls, 1, 'only the direct Mistral call is folded')
  assert.equal(day.input, 10)
  assert.equal(day.byModel['mistral-vibe/deepseek-v4-1-flash-1017'], undefined)
})

test('the Magpie quota answer carries the window fields the cost meter renders', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(magpieQuotasBody()), { status: 200 })
  try {
    const answer = await __test.queryMagpieQuota(undefined, 'http://127.0.0.1:3425', 1000)
    assert.ok('mistral' in answer.windows, 'the Mistral subscription is a window')
    assert.ok('mistral-vibe' in answer.windows, 'the Vibe subscription is a window')
    // The last-served subscription's remaining money is the balance row.
    assert.equal(answer.windows.balance.text, '$99.92')
    for (const window of Object.values(answer.windows)) {
      for (const key of Object.keys(window)) assert.ok(['percent', 'resetsAt', 'text'].includes(key), `unexpected field ${key}`)
    }
    assert.equal(answer.windows.mistral.percent, 16.2)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a gateway that is down is a soft failure for the cost meter', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  try {
    await assert.rejects(() => __test.queryMagpieQuota(undefined, 'http://127.0.0.1:3425', 1000), (error) => {
      assert.equal(error.soft, true)
      assert.match(error.message, /not answering/)
      return true
    })
  } finally {
    globalThis.fetch = realFetch
  }
})

// #endregion


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
