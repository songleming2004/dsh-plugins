/**
 * Behaviour checks for the local build plugins tab.
 *
 * The bundle is a browser script (it calls `window.__ModuleLoader__.load`), so
 * this harness loads the real file in a `vm` context with a small stand-in for
 * the React hook runtime and a fake `pluginManager` remote. It exercises the
 * bulk action's two directions — disable every other local build while any is
 * on, enable them all once every one is off — without booting the app.
 *
 * Run: node --test test/client.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const CLIENT_FILE = path.join(HERE, '..', 'client.js')
const SOURCE = fs.readFileSync(CLIENT_FILE, 'utf8')

const OWN = '@local/dsh-local-build-plugins'
const SELF = '@local/dsh-local-build-plugins-tab'

/**
 * A minimal React stand-in: one hook slot per component instance, enough for
 * `useState` and `useEffect`/`useCallback` as the tab uses them. Rendering is
 * not simulated; the test drives the returned element tree directly.
 */
function makeReact() {
  const slots = []
  const effects = []
  let cursor = 0
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState: (initial) => {
      const at = cursor++
      if (!(at in slots)) slots[at] = initial
      // Read the slot on every render so a setState from an effect is visible
      // to the next render, as React does.
      return [slots[at], (next) => {
        slots[at] = typeof next === 'function' ? next(slots[at]) : next
      }]
    },
    useCallback: (fn) => fn,
    // Collect the effect so the test can run it and await the async load.
    useEffect: (fn) => {
      effects.push(fn)
    },
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
  }
  return {
    React,
    reset: () => {
      slots.length = 0
      cursor = 0
    },
    beginRender: () => {
      cursor = 0
    },
    /**
     * Run the effects a render queued. The tab's load effect starts an async
     * `listBundles` without returning its promise, so drain the microtask queue
     * afterwards to let the resulting setState land.
     */
    runEffects: async () => {
      const queued = effects.splice(0, effects.length)
      for (const fn of queued) await fn()
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
    },
  }
}

/** Build the component the way `apply` does, keeping the factory reachable. */
function buildTab(packages) {
  const calls = []
  const runtime = makeReact()
  let registered = null
  const context = {
    window: { __ModuleLoader__: { load: (r) => (registered = r) } },
    React: runtime.React,
    console: { warn: () => {}, error: () => {} },
  }
  vm.createContext(context)
  vm.runInContext(SOURCE, context)

  const remote = {
    listBundles: async () => ({ ok: true, value: packages }),
    setBundleEnabled: async (name, enabled) => {
      calls.push([name, enabled])
      return { ok: true }
    },
  }
  const ctx = {
    remote: { pluginManager: remote },
    locale: { resolveText: (text) => String(text), register: () => {}, bind: () => (key) => key },
    slots: { inject: () => {}, register: () => {} },
    // `apply` wraps its registrations in `ctx.effect`; run the callback so the
    // slot registration actually happens, as the real runtime does.
    effect: (fn) => fn(),
  }
  const exported = registered.factory((name) => {
    if (name === 'react') return runtime.React
    throw new Error(`unexpected require: ${name}`)
  })
  // `apply` registers the component through slots.inject; capture it instead.
  let Tab = null
  ctx.slots.inject = (_slot, factory) => {
    factory()
  }
  ctx.slots.register = (_options, component) => {
    Tab = component
  }
  exported.apply(ctx)
  /**
   * Render the tab once and let its load effect settle, so the returned tree is
   * the ready state with its rows and bulk button.
   * @param t - the translate function the slot would pass.
   * @returns the rendered element tree.
   */
  const render = async (t) => {
    runtime.beginRender()
    const tree = Tab({ t })
    await runtime.runEffects()
    runtime.beginRender()
    return Tab({ t })
  }
  return { Tab, calls, runtime, render }
}

/** Flatten an element tree into the text it renders. */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node.children) return node.children.map(textOf).join('')
  return ''
}

/** Find the bulk button (the only enabled button outside the rows). */
function bulkButton(tree) {
  const found = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.type === 'button' && node.props && typeof node.props.onClick === 'function' && node.props.role === undefined) {
      found.push(node)
    }
    if (node.children) node.children.forEach(walk)
  }
  walk(tree)
  return found[found.length - 1]
}

const row = (name, enabled) => ({
  name,
  version: '1.0.0',
  installed: true,
  official: false,
  enabled,
  source: `link:/Users/x/.dsh/plugins/${name.split('/')[1]}`,
})

test('while any other local build is on, the bulk action disables them all', async () => {
  const packages = [row(OWN, true), row('@local/dsh-turn-notify', true), row('@local/dsh-prompt-library', false)]
  const { calls, render } = buildTab(packages)
  const tree = await render((key, vars) => (vars ? key + JSON.stringify(vars) : key))
  const button = bulkButton(tree)
  assert.match(textOf(button), /actionDisableCount/)
  await button.props.onClick()
  assert.deepEqual(calls, [['@local/dsh-turn-notify', false]])
})

test('once every other local build is off, the bulk action enables them all', async () => {
  const packages = [row(OWN, true), row('@local/dsh-turn-notify', false), row('@local/dsh-prompt-library', false)]
  const { calls, render } = buildTab(packages)
  const tree = await render((key, vars) => (vars ? key + JSON.stringify(vars) : key))
  const button = bulkButton(tree)
  assert.match(textOf(button), /actionEnableCount/)
  await button.props.onClick()
  // Rows are sorted by package name, so prompt-library precedes turn-notify.
  assert.deepEqual(calls, [
    ['@local/dsh-prompt-library', true],
    ['@local/dsh-turn-notify', true],
  ])
})

test('the bulk action never touches the bundle it belongs to', async () => {
  const packages = [row(OWN, true), row('@local/dsh-turn-notify', true)]
  const { calls, render } = buildTab(packages)
  const tree = await render((key) => key)
  await bulkButton(tree).props.onClick()
  assert.equal(calls.some(([name]) => name === OWN), false)
})

test('the tab package itself is never listed or switched', async () => {
  const packages = [row(OWN, true), row(SELF, false), row('@local/dsh-turn-notify', false)]
  const { calls, render } = buildTab(packages)
  const tree = await render((key) => key)
  assert.equal(textOf(tree).includes(SELF), false)
  await bulkButton(tree).props.onClick()
  assert.equal(calls.some(([name]) => name === SELF), false)
})

test('a mixed list disables rather than enabling the off ones', async () => {
  const packages = [row(OWN, true), row('@local/a', true), row('@local/b', false), row('@local/c', false)]
  const { calls, render } = buildTab(packages)
  const tree = await render((key) => key)
  await bulkButton(tree).props.onClick()
  assert.deepEqual(calls, [['@local/a', false]])
})

test('with no other local builds the bulk button is disabled', async () => {
  const packages = [row(OWN, true)]
  const { render } = buildTab(packages)
  const tree = await render((key) => key)
  const button = bulkButton(tree)
  assert.equal(button.props.disabled, true)
})
