/**
 * Behaviour checks for the sidebar-enhance bundle.
 *
 * The bundle is a browser script (it calls `window.__ModuleLoader__.load`), so
 * this harness loads the real file in a `vm` context with a small stand-in for
 * the DOM, the layout frame, and the React hook runtime. It exercises the two
 * components' install paths and the width solve/fallback without booting the app.
 *
 * Run: node --test test/
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const CLIENT_FILE = path.join(HERE, '..', 'client.js')
const SOURCE = fs.readFileSync(CLIENT_FILE, 'utf8')
const SCROLL_STYLE_ID = '@local/dsh-sidebar-enhance/sidebar-scroll.css'

/** One fake DOM element with the surface the bundle actually touches. */
function element({ width = 0, attrs = {}, hidden = false, style = {} } = {}) {
  const attributes = new Map(Object.entries(attrs))
  const children = []
  const el = {
    style: { ...style },
    isConnected: true,
    dataset: {},
    hidden,
    children,
    get lastElementChild() {
      return children.length === 0 ? null : children[children.length - 1]
    },
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    closest: (selector) => (hidden && selector.includes('[hidden]') ? el : null),
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 20 }),
    dispatchEvent: () => true,
    appendChild(child) {
      children.push(child)
      child.parentElement = el
      return child
    },
    remove() {
      el.removed = true
      const parent = el.parentElement
      if (parent === undefined) return
      const index = parent.children.indexOf(el)
      if (index >= 0) parent.children.splice(index, 1)
    },
    querySelector(selector) {
      if (selector.startsWith(':scope > [')) {
        const attribute = selector.slice(':scope > ['.length, -1)
        return children.find((child) => child.hasAttribute(attribute)) ?? null
      }
      return null
    },
  }
  return el
}

/**
 * Boot one isolated copy of the bundle.
 * @returns {Promise<object>} the captured plugin plus the handles a test drives.
 */
function boot() {
  const created = []
  const rafCallbacks = []
  const observers = []
  const styleSheets = []

  const frame = element({ width: 1280 })
  const rightbarCol = element({ width: 450 })
  rightbarCol.parentElement = frame
  const handle = element({ width: 8 })

  const elements = {
    '[data-rightbar-col]': rightbarCol,
    '[data-side="rightbar"]': handle,
  }
  /** Panels the fake document reports for the guard's scan. */
  let panels = []
  /** Guides the fake document reports for the bottom-spacer sweep. */
  let guides = []

  class FakePointerEvent {
    constructor(type, init) {
      Object.assign(this, init)
      this.type = type
    }
  }

  const document = {
    documentElement: element({}),
    head: {
      appendChild(tag) {
        created.push(tag)
        styleSheets.push(tag)
      },
    },
    createElement(tagName) {
      const tag = element({})
      tag.tagName = tagName
      tag.textContent = ''
      tag.remove = () => {
        tag.removed = true
      }
      return tag
    },
    querySelector(selector) {
      return elements[selector] ?? null
    },
    querySelectorAll(selector) {
      if (selector.startsWith('style[data-plugin-css=')) {
        return styleSheets.filter((tag) => !tag.removed)
      }
      if (selector === '[data-sidebar-right-session][data-sidebar-right-panel]') {
        return panels.filter((panel) => panel.isConnected)
      }
      if (selector === '[data-sidebar-right-session] [data-sidebar-right-guide]') {
        return guides
      }
      return []
    },
  }

  const window = {
    innerWidth: 1280,
    getComputedStyle: () => ({ gridTemplateColumns: '280px 550px 450px' }),
    requestAnimationFrame: (callback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    },
    cancelAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    PointerEvent: FakePointerEvent,
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe() {}
    disconnect() {}
  }

  const defs = []
  window.__ModuleLoader__ = { load: (definition) => defs.push(definition) }

  const cleanups = []
  const React = {
    createElement: () => null,
    useEffect: (effect) => {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }

  globalThis.window = window
  globalThis.document = document
  globalThis.MutationObserver = FakeMutationObserver
  vm.runInThisContext(SOURCE, { filename: CLIENT_FILE })

  const definition = defs[defs.length - 1]
  assert.equal(definition.id, '@local/dsh-sidebar-enhance')
  const plugin = definition.factory((id) => (id === 'react' ? React : {}))

  const components = []
  const ctx = {
    effect: (effect) => {
      effect()
    },
    slots: {
      inject: (name, register) => register(),
      register: (options, Component) => {
        components.push({ options, Component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  return {
    plugin,
    window,
    document,
    frame,
    rightbarCol,
    handle,
    components,
    observers,
    created,
    /** Replace the open panels reported to the guard. */
    setPanels(next) {
      panels = next
    },
    /** Replace the guides reported to the bottom-spacer sweep. */
    setGuides(next) {
      guides = next
    },
    /** Run every queued animation frame. */
    flushFrame() {
      const queued = rafCallbacks.splice(0)
      for (const callback of queued) callback()
    },
    /** Render both registered components (their effects install the behaviours). */
    render() {
      for (const { Component } of components) Component({})
    },
    /** Fire every MutationObserver callback, as a DOM change would. */
    mutate() {
      for (const observer of observers) observer.callback([])
    },
    cleanup() {
      for (const dispose of cleanups.splice(0)) dispose()
      delete globalThis.window
      delete globalThis.document
      delete globalThis.MutationObserver
    },
  }
}

/** A panel in the shape the right Sidebar renders. */
function panel({ session = 'session-1', width = 450, mode = 'push', open = true, hidden = false } = {}) {
  const attrs = {
    'data-sidebar-right-session': session,
    'data-sidebar-right-panel': mode,
  }
  if (open) attrs['data-sidebar-right-open'] = ''
  return element({ width, hidden, attrs, style: { width: `${width}px` } })
}

test('the bundle is one plugin with two overlay components', () => {
  const app = boot()
  try {
    assert.deepEqual(app.plugin.inject, ['slots'])
    assert.equal(app.components.length, 2)
    assert.deepEqual(app.components.map((entry) => entry.options.id), [
      '@local/dsh-sidebar-enhance:width-guard',
      '@local/dsh-sidebar-enhance:scroll',
    ])
  } finally {
    app.cleanup()
  }
})

test('first opening of a Session is capped at one third of panel + conversation', () => {
  const app = boot()
  try {
    const panelElement = panel()
    app.setPanels([panelElement])
    const calls = []
    app.frame['__reactFiber$test'] = {
      memoizedProps: { actions: { setRightbar: (px) => calls.push(px) } },
      return: null,
    }

    app.render()
    app.flushFrame()

    // (1280 − 280) / 3 = 333.33 → 333
    assert.deepEqual(calls, [333])
  } finally {
    app.cleanup()
  }
})

test('the cap runs once per Session, not on every reopen', () => {
  const app = boot()
  try {
    const panelElement = panel()
    app.setPanels([panelElement])
    const calls = []
    app.frame['__reactFiber$test'] = {
      memoizedProps: { actions: { setRightbar: (px) => calls.push(px) } },
      return: null,
    }

    app.render()
    app.flushFrame()
    app.mutate()
    app.flushFrame()
    app.mutate()
    app.flushFrame()

    assert.equal(calls.length, 1)
  } finally {
    app.cleanup()
  }
})

test('a different Session gets its own cap', () => {
  const app = boot()
  try {
    const first = panel({ session: 'session-1' })
    const second = panel({ session: 'session-2' })
    app.setPanels([first])
    const calls = []
    app.frame['__reactFiber$test'] = {
      memoizedProps: { actions: { setRightbar: (px) => calls.push(px) } },
      return: null,
    }

    app.render()
    app.flushFrame()
    app.setPanels([second])
    app.mutate()
    app.flushFrame()

    assert.equal(calls.length, 2)
  } finally {
    app.cleanup()
  }
})

test('a panel already within the rule is left alone', () => {
  const app = boot()
  try {
    app.setPanels([panel({ width: 300 })])
    const calls = []
    app.frame['__reactFiber$test'] = {
      memoizedProps: { actions: { setRightbar: (px) => calls.push(px) } },
      return: null,
    }

    app.render()
    app.flushFrame()

    assert.deepEqual(calls, [])
  } finally {
    app.cleanup()
  }
})

test('a hidden retained Session and a fullscreen panel are skipped', () => {
  const app = boot()
  try {
    app.setPanels([panel({ session: 'hidden', hidden: true })])
    const calls = []
    app.frame['__reactFiber$test'] = {
      memoizedProps: { actions: { setRightbar: (px) => calls.push(px) } },
      return: null,
    }
    app.render()
    app.flushFrame()

    app.setPanels([panel({ session: 'full', mode: 'fullscreen' })])
    app.mutate()
    app.flushFrame()

    assert.deepEqual(calls, [])
  } finally {
    app.cleanup()
  }
})

test('the fiber walk climbs past nodes without layout actions', () => {
  const app = boot()
  try {
    app.setPanels([panel()])
    const calls = []
    app.frame['__reactFiber$test'] = {
      memoizedProps: { children: null },
      return: {
        memoizedProps: {},
        return: {
          memoizedProps: { actions: { setRightbar: (px) => calls.push(px) } },
          return: null,
        },
      },
    }

    app.render()
    app.flushFrame()

    assert.deepEqual(calls, [333])
  } finally {
    app.cleanup()
  }
})

test('without fiber access the guard drags the product handle by the right distance', () => {
  const app = boot()
  try {
    app.setPanels([panel({ width: 450 })])
    const events = []
    app.handle.dispatchEvent = (event) => {
      events.push(event)
      return true
    }

    app.render()
    app.flushFrame()

    assert.equal(events.length, 2)
    assert.equal(events[0].type, 'pointerdown')
    assert.equal(events[1].type, 'pointerup')
    // Dragging right shrinks the right column: 450 − 333 = 117.
    assert.equal(events[1].clientX - events[0].clientX, 117)
  } finally {
    app.cleanup()
  }
})

test('the target width subtracts the left sidebar from the frame', () => {
  const app = boot()
  try {
    const frame = element({ width: 1200 })
    app.window.getComputedStyle = () => ({ gridTemplateColumns: '300px 900px 0px' })
    const target = app.plugin.internals.computeTargetWidth(frame)
    assert.equal(target, 300) // (1200 − 300) / 3 = 300
  } finally {
    app.cleanup()
  }
})

test('the target keeps the 300px column floor on narrow frames', () => {
  const app = boot()
  try {
    const frame = element({ width: 900 })
    app.window.getComputedStyle = () => ({ gridTemplateColumns: '280px 620px 0px' })
    const target = app.plugin.internals.computeTargetWidth(frame)
    assert.equal(target, 300)
  } finally {
    app.cleanup()
  }
})

test('the scroll component installs one replaceable stylesheet', () => {
  const app = boot()
  try {
    app.render()
    const sheet = app.created.find((tag) => tag.dataset.pluginCss === SCROLL_STYLE_ID)
    assert.ok(sheet, 'a stylesheet is appended')
    assert.match(sheet.textContent, /\[data-sidebar-right-session\] \[data-sidebar-right-tab\]/)
    assert.match(sheet.textContent, /overflow-y: auto/)
    assert.match(sheet.textContent, /overflow-x: hidden/)
    assert.match(sheet.textContent, /\[data-sidebar-right-session\] \[data-sidebar-right-guide\]/)
    assert.match(sheet.textContent, /justify-content: safe center/)
    assert.match(sheet.textContent, /::-webkit-scrollbar\b/)
    assert.match(sheet.textContent, /::-webkit-scrollbar-thumb/)

    app.plugin.internals.installScrollStyles()
    assert.equal(app.document.querySelectorAll('style[data-plugin-css=' + JSON.stringify(SCROLL_STYLE_ID) + ']').length, 1)
  } finally {
    app.cleanup()
  }
})

test('the scroll component keeps one real bottom spacer after the guide cards', () => {
  const app = boot()
  try {
    const card = element({})
    const guide = element({})
    guide.appendChild(card)
    app.setGuides([guide])

    app.render()
    app.flushFrame()

    const spacer = guide.lastElementChild
    assert.ok(spacer, 'a spacer is appended')
    assert.ok(spacer.hasAttribute(app.plugin.internals.SPACER_ATTR))

    // A second sweep must not stack another spacer.
    app.plugin.internals.ensureBottomSpacers()
    assert.equal(guide.children.length, 2)
    assert.equal(guide.children.filter((child) => child.hasAttribute(app.plugin.internals.SPACER_ATTR)).length, 1)

    // React appends a card after the spacer: the spacer moves back to the end.
    const late = element({})
    guide.appendChild(late)
    app.plugin.internals.ensureBottomSpacers()
    assert.equal(guide.lastElementChild, spacer)
    assert.equal(guide.children[guide.children.length - 1], spacer)
  } finally {
    app.cleanup()
  }
})
