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
  // The stub never renders a component element, so render it here the way
  // React would: call the function with its props and flatten the result.
  if (typeof node.type === 'function') return flatten(node.type(node.props))
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
        provider: 'mistral',
        followed: 'mistral',
        providers: ['mistral', 'magpie'],
        plan: 'EDU',
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
    // The card is a container: the title is the refresh hit-area, and the
    // provider switch sits below it so a segment click never refreshes.
    const head = card.props.children.find((child) => child?.props?.className === 'mu-card-head')
    const hit = head.props.children[0]
    assert.equal(hit.props.role, 'button', 'the title is a button')
    assert.equal(hit.props.tabIndex, 0, 'the title is reachable by keyboard')
    const before = calls.length
    hit.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(calls.length, before + 1, 'a click asks the Host once more')
    assert.equal(calls[calls.length - 1].refresh, true, 'the click asks for a fresh probe')

    // Enter and Space do the same thing for keyboard users.
    const again = calls.length
    const prevented = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    hit.props.onKeyDown({ key: 'Enter', preventDefault: prevented.preventDefault.bind(prevented) })
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
      provider: 'mistral',
      followed: 'mistral',
      providers: ['mistral', 'magpie'],
      plan: 'EDU',
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

/** A Magpie answer shaped like the Host's, for the client checks. */
function magpieAnswer() {
  return {
    provider: 'magpie',
    followed: 'magpie',
    providers: ['mistral', 'magpie'],
    status: 'ok',
    baseURL: 'http://127.0.0.1:3425',
    period: '30d',
    plan: 'Student',
    subscription: 'mistral-vibe',
    magpieCredential: { ref: 'MAGPIE_GATEWAY_KEY', configured: false, writable: true },
    subscriptions: [
      {
        provider: 'mistral',
        name: 'Mistral',
        plan: 'Student',
        windows: [{ name: 'API · Month', percent: 16.2, spent: 2.43, limit: 15, remaining: 12.57, currency: 'USD', resetAt: '2026-12-01T00:00:00Z' }],
      },
      {
        provider: 'mistral-vibe',
        name: 'Mistral Vibe',
        plan: 'Student',
        last: true,
        windows: [{ name: 'Month', percent: 0.08, spent: 0.12, limit: 150, remaining: 149.88, currency: 'USD', resetAt: '2026-12-01T00:00:00Z' }],
      },
    ],
    bar: { value: 0.12, max: 150, percent: 0.08, source: 'account', budget: 'Month', currency: 'USD', resetAt: '2026-12-01T00:00:00Z' },
    usage: {
      period: '30d',
      bucket: 'day',
      path: '~/.config/magpie/usage.jsonl',
      sessionCount: 3,
      today: { label: 'Nov 8', calls: 10, input: 900, output: 180, cacheRead: 5000, cacheWrite: 0, cost: 0.24, errors: 0 },
      total: { calls: 12, input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0, cost: 0.25, errors: 1, unpriced: 0 },
      byModel: [{ model: 'mistral-vibe/deepseek-v4-1-flash-1017', calls: 12, input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0, cost: 0.25, priceSource: 'magpie' }],
      agents: [{ id: 'dsh', name: 'DeepSeek Harness', calls: 12, cost: 0.25 }],
      series: [],
    },
    ledger: null,
  }
}

test('the card follows the session route onto Magpie and shows its figures', async () => {
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
    return { ok: true, status: 200, json: async () => magpieAnswer() }
  }
  try {
    plugin.apply(ctx)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const entries = registrations.filter((entry) => entry.component !== undefined)
    const footer = entries.find((entry) => entry.options.name === 'sidebar.footer.action')
    const section = entries.find((entry) => entry.options.name === 'settings.section')
    const wide = flatten(footer.component({ wide: true }))
    // The route is Magpie, so the card is Magpie's without anyone picking it.
    assert.match(wide, /Magpie/, 'the card names Magpie')
    assert.match(wide, /Student/, 'the plan comes from the subscription')
    assert.match(wide, /150\.00/, 'the served window is the bar')
    assert.match(wide, /0\.12/, 'the amount spent is shown')
    assert.match(wide, /6\.1K/, "today's tokens are shown")
    assert.doesNotMatch(wide, /15\.00/, "the other subscription's window is not the bar")
    const rail = flatten(footer.component({ wide: false }))
    assert.match(rail, /0%/, 'the rail tile carries the percentage')

    const page = flatten(section.component({}))
    assert.match(page, /Mistral Vibe/, 'the settings page lists the subscriptions')
    assert.match(page, /API · Month/, 'the other window is listed too')
    assert.match(page, /DeepSeek Harness/, 'the per-agent table renders')
    assert.match(page, /mistral-vibe\/deepseek-v4-1-flash-1017/, 'the per-model table renders')
    assert.match(page, /\/\.config\/magpie\/usage\.jsonl/, 'the source file is named')
    assert.match(page, /Magpie/, 'the key card is Magpie’s')
  } finally {
    globalThis.fetch = realFetch
    for (const dispose of effects) if (typeof dispose === 'function') dispose()
    restoreDocument()
  }
})

test('a manual pick overrides the route and goes back to following it', async () => {
  const factory = loadFactory()
  const plugin = factory((name) => {
    if (name === 'react') return ReactStub
    throw new Error(`unexpected require: ${name}`)
  })
  const { ctx, registrations, effects } = makeContext()
  const restoreDocument = installDocument()

  const calls = []
  const realFetch = globalThis.fetch
  // The session is on the Magpie route; a manual pick asks for Mistral.
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body ?? '{}')
    calls.push(body)
    if (body.provider === 'mistral') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          provider: 'mistral',
          followed: 'magpie',
          providers: ['mistral', 'magpie'],
          plan: 'EDU',
          credential: { ref: 'MISTRAL_API_KEY', configured: true },
          consumption: { status: 'ok', plan: 'EDU', currency: 'USD', api: { kind: 'api', spent: 1, limit: 15, percent: 6.7, currency: 'USD' } },
          ledger: { today: { calls: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, byModel: [] }, total: { calls: 1 } },
          bar: { value: 1, max: 15, percent: 6.7, source: 'account', budget: 'api', currency: 'USD' },
          costMeter: { enabled: true, connected: false, windows: [] },
        }),
      }
    }
    return { ok: true, status: 200, json: async () => magpieAnswer() }
  }
  try {
    plugin.apply(ctx)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const footer = registrations.find((entry) => entry.options?.name === 'sidebar.footer.action')
    /**
     * The provider switch of a rendered card. The stub `createElement` keeps a
     * component element unrendered, so the switch function is invoked here the
     * way React would.
     * @param {object} card - the rendered card element.
     * @returns {object[]} the segment elements.
     */
    const segmentsOf = (card) => {
      // The switch is a component element, so it carries no className of its own.
      // The switch is the only component element whose props carry a pick.
      const sw = card.props.children.find((child) => typeof child?.type === 'function' && 'pick' in (child.props ?? {}))
      const rendered = sw.type(sw.props)
      // The segments come from a `.map()`, so they arrive as one array child.
      return rendered.props.children
        .flat(Infinity)
        .filter(Boolean)
        .filter((child) => child.props?.type === 'button')
    }
    /** The text of one segment. */
    const segmentText = (seg) => flatten(seg.props.children)
    // No pick yet: the card follows the route and sends no provider.
    assert.equal(calls[calls.length - 1].provider, undefined, 'following sends no provider')
    let segments = segmentsOf(footer.component({ wide: true }))
    assert.equal(segments.length, 2, 'both providers are offered')
    // Pick Mistral by hand.
    const mistralSegment = segments.find((seg) => segmentText(seg) === 'Mistral')
    mistralSegment.props.onClick({ stopPropagation() {} })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(calls[calls.length - 1].provider, 'mistral', 'the pick is sent')
    const wide = flatten(footer.component({ wide: true }))
    assert.match(wide, /EDU/, 'the picked provider is shown')
    assert.match(wide, /正在显示 Mistral/, 'the override is named')
    // Picking the same segment again goes back to following the route.
    segments = segmentsOf(footer.component({ wide: true }))
    const same = segments.find((seg) => segmentText(seg) === 'Mistral')
    same.props.onClick({ stopPropagation() {} })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(calls[calls.length - 1].provider, undefined, 'following again sends no provider')
    assert.match(flatten(footer.component({ wide: true })), /Magpie/, 'the route leads again')
  } finally {
    globalThis.fetch = realFetch
    for (const dispose of effects) if (typeof dispose === 'function') dispose()
    restoreDocument()
  }
})

test('a Magpie gateway that is down says so instead of showing a zero', async () => {
  const factory = loadFactory()
  const plugin = factory((name) => {
    if (name === 'react') return ReactStub
    throw new Error(`unexpected require: ${name}`)
  })
  const { ctx, registrations, effects } = makeContext()
  const restoreDocument = installDocument()

  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      provider: 'magpie',
      followed: 'magpie',
      status: 'unreachable',
      message: 'Magpie is not answering at http://127.0.0.1:3425',
      baseURL: 'http://127.0.0.1:3425',
      subscriptions: [],
      usage: null,
      ledger: null,
      bar: { value: 0, max: 125, source: 'harness', currency: 'USD' },
      magpieCredential: { ref: 'MAGPIE_GATEWAY_KEY', configured: false },
    }),
  })
  try {
    plugin.apply(ctx)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const entries = registrations.filter((entry) => entry.component !== undefined)
    const footer = entries.find((entry) => entry.options.name === 'sidebar.footer.action')
    const section = entries.find((entry) => entry.options.name === 'settings.section')
    const card = footer.component({ wide: true })
    const wide = flatten(card)
    assert.match(wide, /未在 .* 应答/, 'the card says the gateway is down')
    // The title attribute still names the figure, but no bar or amount row
    // claims a zero the gateway never reported.
    const lines = card.props.children.find((child) => child?.props?.className === 'mu-card-lines')
    assert.doesNotMatch(flatten(lines), /\$0/, 'no zero amount is shown')
    assert.ok(!card.props.children.some((child) => child?.props?.className === 'mu-card-bar'), 'no bar is drawn')
    const page = flatten(section.component({}))
    assert.match(page, /未在 .* 应答/, 'the settings page says the same')
    assert.match(page, /无需配置/, 'the key card says a key is not needed')
  } finally {
    globalThis.fetch = realFetch
    for (const dispose of effects) if (typeof dispose === 'function') dispose()
    restoreDocument()
  }
})
