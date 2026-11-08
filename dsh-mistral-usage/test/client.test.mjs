/**
 * Browser-side checks for the Mistral usage bundle.
 *
 * The module registers itself through `window.__ModuleLoader__.load`, so the
 * test captures the factory, drives `apply()` against a small stand-in for the
 * Client context, and renders the two surfaces with `react-dom/server` to make
 * sure they produce the figures the Host reports.
 *
 * Run with `node --test test/client.test.mjs`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(here)

/**
 * Load the module's factory the way the page's module loader does.
 * @returns {(require: Function) => object} the plugin module.
 */
function loadFactory() {
  let captured
  const previous = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        captured = definition
      },
    },
  }
  try {
    const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
    // The module body only calls the loader; evaluating it captures the factory.
    new Function('window', source)(globalThis.window)
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
  assert.ok(captured !== undefined, 'the module registers itself')
  assert.equal(captured.id, '@local/dsh-mistral-usage')
  return captured.factory
}

/** A minimal document so the stylesheet and poll effects can run. */
function installDocument() {
  const previous = globalThis.document
  const tags = []
  globalThis.document = {
    visibilityState: 'visible',
    head: { appendChild: (tag) => tags.push(tag) },
    createElement: (name) => ({ name, dataset: {}, textContent: '', remove() {} }),
    addEventListener() {},
    removeEventListener() {},
  }
  return () => {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

/**
 * A stand-in for the Client context the plugin uses.
 * @returns {{ ctx: object, registrations: object[], effects: Function[] }} the context and what it recorded.
 */
function makeContext() {
  const registrations = []
  const effects = []
  const locale = {
    active: 'zh',
    register() {
      return () => {}
    },
    bind: () => (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    getSnapshot: () => ({ active: locale.active }),
    subscribe: () => () => {},
  }
  const slots = {
    inject(slot, factory) {
      const dispose = factory()
      registrations.push({ slot, dispose })
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  }
  const ctx = {
    locale,
    slots,
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return () => {}
    },
  }
  return { ctx, registrations, effects }
}

/** A React stand-in good enough to build elements and read their props. */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children: children.length === 0 ? undefined : children } }),
  Fragment: 'Fragment',
  useCallback: (fn) => fn,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

test('the module registers its surfaces', () => {
  const factory = loadFactory()
  const plugin = factory((name) => {
    if (name === 'react') return ReactStub
    throw new Error(`unexpected require: ${name}`)
  })
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  const { ctx, registrations, effects } = makeContext()
  const restore = installDocument()
  try {
    plugin.apply(ctx)
  } finally {
    // The poll interval would otherwise keep the test process alive.
    for (const dispose of effects) if (typeof dispose === 'function') dispose()
    restore()
  }
  const slots = registrations.filter((entry) => entry.options !== undefined).map((entry) => entry.options)
  const footer = slots.find((options) => options.name === 'sidebar.footer.action')
  const section = slots.find((options) => options.name === 'settings.section')
  const icon = slots.find((options) => options.name === 'settings.section.icon')
  assert.ok(footer, 'the sidebar card registers')
  assert.equal(footer.id, 'mistral-usage')
  assert.ok(section, 'the settings page registers')
  assert.equal(section.id, 'mistral-usage')
  assert.equal(section.order, 32)
  assert.ok(icon, 'the settings icon registers')
  assert.equal(icon.id, 'mistral-usage')
})

/**
 * Render an element tree built by the plugin's own `h` into text, so the
 * surfaces can be checked without a browser or a React build.
 * @param {object} node - element or text.
 * @returns {string} the text content.
 */
function flatten(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten).join(' ')
  const children = node.props?.children
  const own = typeof node.props?.title === 'string' ? node.props.title : ''
  return `${own} ${flatten(children)}`
}

test('clicking the card asks the Host to re-probe the billing API', async () => {
  const factory = loadFactory()
  const plugin = factory((name) => {
    if (name === 'react') return ReactStub
    throw new Error(`unexpected require: ${name}`)
  })
  const { ctx, registrations, effects } = makeContext()
  const restoreDocument = installDocument()

  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init?.body ?? '{}'))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        credential: { ref: 'MISTRAL_API_KEY', configured: true },
        consumption: { status: 'ok', plan: 'EDU', currency: 'USD', api: { kind: 'api', spent: 1, limit: 15, percent: 6.7, currency: 'USD' } },
        ledger: { today: { calls: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, byModel: [] }, total: { calls: 1 } },
        bar: { value: 1, max: 15, percent: 6.7, source: 'account', budget: 'api', currency: 'USD' },
        costMeter: { enabled: true, connected: false, windows: [] },
      }),
    }
  }
  try {
    plugin.apply(ctx)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const footer = registrations.find((entry) => entry.options?.name === 'sidebar.footer.action')
    const card = footer.component({ wide: true })
    assert.equal(card.props.role, 'button', 'the card is a button')
    assert.equal(card.props.tabIndex, 0, 'the card is reachable by keyboard')
    const before = calls.length
    card.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(calls.length, before + 1, 'a click asks the Host once more')
    assert.equal(calls[calls.length - 1].refresh, true, 'the click asks for a fresh probe')

    // Enter and Space do the same thing for keyboard users.
    const again = calls.length
    const prevented = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    card.props.onKeyDown({ key: 'Enter', preventDefault: prevented.preventDefault.bind(prevented) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(calls.length, again + 1, 'Enter refreshes')
    assert.equal(prevented.defaultPrevented, true, 'Enter does not also submit a form')

    // The rail tile is the same affordance.
    const rail = footer.component({ wide: false })
    assert.equal(rail.props.role, 'button')
    assert.match(rail.props.className, /mu-clickable/)
  } finally {
    globalThis.fetch = realFetch
    for (const dispose of effects) if (typeof dispose === 'function') dispose()
    restoreDocument()
  }
})

test('both surfaces render the figures the Host reports', async (t) => {
  const factory = loadFactory()
  const plugin = factory((name) => {
    if (name === 'react') return ReactStub
    throw new Error(`unexpected require: ${name}`)
  })
  const { ctx, registrations, effects } = makeContext()
  const restoreDocument = installDocument()

  // Answer the bridge the way the Host does.
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      credential: { ref: 'MISTRAL_API_KEY', configured: true, source: 'file', writable: true },
      consumption: {
        status: 'ok',
        plan: 'EDU',
        currency: 'USD',
        vibe: { kind: 'vibe', spent: 0, limit: 150, percent: 0, currency: 'USD', resetAt: '2026-12-01T00:00:00Z' },
        api: { kind: 'api', spent: 0.81, limit: 15, percent: 5.4, currency: 'USD', resetAt: '2026-12-01T00:00:00Z' },
      },
      ledger: {
        today: {
          calls: 150,
          input: 3059833,
          output: 65397,
          cacheRead: 23911552,
          cacheWrite: 0,
          reasoning: 0,
          cost: 1.16,
          byModel: [{ model: 'deepseek-v4-1-flash-1017', calls: 150, input: 3059833, output: 65397, cacheRead: 23911552, cacheWrite: 0, cost: 1.16, priceSource: 'published' }],
        },
        total: { calls: 150, input: 3059833, output: 65397, cacheRead: 23911552, cacheWrite: 0, reasoning: 0, cost: 1.16 },
      },
      bar: { value: 0.81, max: 15, percent: 5.4, source: 'account', budget: 'api', currency: 'USD', resetAt: '2026-12-01T00:00:00Z' },
      costMeter: { enabled: true, connected: false, windows: [] },
    }),
  })
  try {
    plugin.apply(ctx)
    // Let the first poll settle.
    await new Promise((resolve) => setTimeout(resolve, 20))
    const entries = registrations.filter((entry) => entry.component !== undefined)
    const footer = entries.find((entry) => entry.options.name === 'sidebar.footer.action')
    const section = entries.find((entry) => entry.options.name === 'settings.section')
    const wide = flatten(footer.component({ wide: true }))
    assert.match(wide, /EDU/, 'the plan is shown')
    assert.match(wide, /15\.00/, 'the API budget limit is shown')
    assert.match(wide, /0\.81/, 'the API budget spend is shown')
    assert.doesNotMatch(wide, /150\.00/, 'the Vibe allowance is not shown')
    assert.match(wide, /27\.0M/, "today's tokens are shown")
    const rail = flatten(footer.component({ wide: false }))
    assert.match(rail, /5%/, 'the rail tile carries the API percentage')
    const page = flatten(section.component({}))
    assert.match(page, /deepseek-v4-1-flash-1017/, 'the per-model table lists the model')
    assert.match(page, /API Key/, 'the key card renders')
    assert.match(page, /\$14\.19/, 'the settings page shows what is left of the API budget')
    assert.doesNotMatch(page, /150\.00/, 'the settings page omits the Vibe allowance')
    assert.match(page, /EDU/, 'the settings page repeats the plan')
  } finally {
    globalThis.fetch = realFetch
    for (const dispose of effects) if (typeof dispose === 'function') dispose()
    restoreDocument()
  }
})
