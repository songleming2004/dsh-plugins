/**
 * Sidebar enhance — one bundle, two browser-side components over the right
 * Sidebar.
 *
 * The two components are registered into the frame-wide overlay layer, but
 * they draw nothing: each one installs a behaviour and cleans it up when the
 * bundle unloads. Plugin Manager still lists the bundle as a single plugin.
 *
 * 1. `SidebarWidthGuard` — the right Sidebar opens at 45% of the frame on its
 *    first opening (`RIGHTBAR_DEFAULT_RATIO` in `@deepseek-ai/dsh-client-ui-layout`).
 *    On a typical desktop frame that makes the panel about as wide as the
 *    conversation next to it. This guard caps the first opening of every Session
 *    (and of a freshly started app) at one third of "panel + conversation":
 *
 *        R ≤ (R + C) / 3  ⇔  3R ≤ frame − leftSidebar
 *
 *    so it solves `R = (frameWidth − sidebarWidth) / 3`, clamped to the
 *    column's 300px floor. The cap is applied once per Session and only while
 *    the Session's panel is being opened for the first time in this app run, so
 *    a user's later drag — wider or narrower — is never fought.
 *
 *    The layout store owns the width and exposes no width action on
 *    `ctx.layout`, so the guard uses the same two doors the product itself
 *    uses, in order of safety:
 *
 *      a. The frame's `AppFrame` component receives the bound layout `actions`
 *         prop. Walking the React fiber from the frame DOM node to that
 *         component reaches `actions.setRightbar(px)`, which is exactly what
 *         the built-in resize handle calls. This runs before the panel paints,
 *         so the first opening never flashes at 45%.
 *      b. If that internal access fails (a future React/build change), the
 *         guard synthesises a pointer drag on the product's own right-handle
 *         (`[data-side="rightbar"]`), which drives the same `setRightbar`
 *         through the public DOM event path.
 *
 * 2. `SidebarScrollEnhancer` — a tab body in the right Sidebar is fixed to
 *    `height: 100%` with `overflow: hidden`, while its parent scrolling pane is
 *    `overflow: auto`. A page whose content is taller than the pane (the guide
 *    with many tool cards is the common case) is therefore clipped and the
 *    outer pane never learns it should scroll. Worse, the guide centres its
 *    cards: centring content taller than the box overflows in both directions,
 *    and only the bottom overflow is scrollable, so the first cards are
 *    unreachable even after scrolling. The component's stylesheet lets each
 *    `[data-sidebar-right-tab]` body scroll on the vertical axis, switches the
 *    guide's centring to `safe center` (centre while it fits, start-align once
 *    it overflows), and draws an always-visible, draggable scrollbar, because
 *    macOS hides overlay scrollbars until the user already knows to scroll.
 *    The guide's shrinkable `:after` spacer collapses to zero as soon as the
 *    cards overflow, which leaves the last card flush with the panel edge at
 *    maximum scroll, so the component also appends a real 24px spacer as the
 *    guide's last flex child (a real child, unlike a pseudo-element or a bottom
 *    margin, counts in the scroll container's overflow).
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-sidebar-enhance',
  factory(require) {
    const React = require('react')

    /** Overlay ids: one per component, so each can be listed and disposed alone. */
    const WIDTH_ID = '@local/dsh-sidebar-enhance:width-guard'
    const SCROLL_ID = '@local/dsh-sidebar-enhance:scroll'
    /** Marks the one stylesheet this bundle owns, so a reload replaces it. */
    const SCROLL_STYLE_ID = '@local/dsh-sidebar-enhance/sidebar-scroll.css'
    /** Marks the real bottom spacer this bundle appends inside the guide. */
    const SPACER_ATTR = 'data-dsh-sidebar-bottom-spacer'
    /** The layout package's right-column floor (`RIGHTBAR_MIN`); the store clamps to it. */
    const RIGHTBAR_MIN = 300
    /** Sub-pixel slack when deciding a panel is already narrow enough. */
    const WIDTH_TOLERANCE = 2
    /** How many frames to keep trying while a just-opened panel settles. */
    const MAX_ATTEMPTS = 40
    /** Delay between those attempts, in milliseconds. */
    const RETRY_MS = 50

    /**
     * The scroll stylesheet.
     *
     * 1. `[data-sidebar-right-tab]` is the tab body wrapper the right Sidebar puts
     *    around every page definition. The built-in class on it fixes `height`
     *    and clips overflow, so a tall page cannot reach its parent's scrollbar.
     *    The rule is `!important` because the built-in class has equal
     *    specificity and is injected by its own package at boot; this stylesheet
     *    is appended later but must survive reload ordering.
     *
     * 2. The guide centres its cards with `justify-content: center`. When the
     *    cards are taller than the pane that centring overflows both the top and
     *    the bottom, and a scroll container only ever exposes the bottom
     *    overflow — the first tools become unreachable. `safe center` keeps the
     *    designed centring while the cards fit and falls back to start alignment
     *    as soon as they overflow, so scrollTop = 0 really is the first card.
     *
     * 3. macOS overlay scrollbars stay invisible until the user scrolls, so a
     *    scrollable Sidebar shows no thumb at all. Styling the WebKit scrollbar
     *    turns every scrollable surface into a classic 10px scrollbar with an
     *    always-visible, draggable thumb. A surface that does not overflow gets
     *    no scrollbar and loses no width.
     */
    const SCROLL_CSS = `
[data-sidebar-right-session] [data-sidebar-right-tab] {
  overflow-y: auto !important;
  overflow-x: hidden !important;
  overscroll-behavior-y: contain;
}

[data-sidebar-right-session] [data-sidebar-right-guide] {
  justify-content: safe center !important;
}

[data-sidebar-right-session] [data-sidebar-right-tab]::-webkit-scrollbar,
[data-sidebar-right-session] [data-sidebar-right-tab] *::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

[data-sidebar-right-session] [data-sidebar-right-tab]::-webkit-scrollbar-track,
[data-sidebar-right-session] [data-sidebar-right-tab] *::-webkit-scrollbar-track {
  background: transparent;
}

[data-sidebar-right-session] [data-sidebar-right-tab]::-webkit-scrollbar-thumb,
[data-sidebar-right-session] [data-sidebar-right-tab] *::-webkit-scrollbar-thumb {
  background: var(--dsh-scrollbar-thumb, var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, 0.5)));
  background-clip: content-box;
  border: 2px solid transparent;
  border-radius: 999px;
}

[data-sidebar-right-session] [data-sidebar-right-tab]::-webkit-scrollbar-thumb:hover,
[data-sidebar-right-session] [data-sidebar-right-tab] *::-webkit-scrollbar-thumb:hover {
  background: var(--dsh-scrollbar-thumb-hover, var(--dsw-alias-scrollbar-hover-l2, rgba(127, 127, 127, 0.75)));
  background-clip: content-box;
  border: 2px solid transparent;
  border-radius: 999px;
}

[data-sidebar-right-session] [data-sidebar-right-tab]::-webkit-scrollbar-corner,
[data-sidebar-right-session] [data-sidebar-right-tab] *::-webkit-scrollbar-corner {
  background: transparent;
}

@supports not selector(::-webkit-scrollbar) {
  [data-sidebar-right-session] [data-sidebar-right-tab],
  [data-sidebar-right-session] [data-sidebar-right-tab] * {
    scrollbar-width: thin;
    scrollbar-color: var(--dsh-scrollbar-thumb, var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, 0.5))) transparent;
  }
}

[data-sidebar-right-session] [data-sidebar-right-guide] > [data-dsh-sidebar-bottom-spacer] {
  flex: 0 0 24px;
  width: 100%;
  pointer-events: none;
}
`

    /**
     * Add the scroll stylesheet to the page.
     *
     * It has to live outside a tab component: it styles every tab body in the
     * right Sidebar, and the Sidebar may be closed when the bundle loads.
     * @returns {() => void} Remove the stylesheet.
     */
    function installScrollStyles() {
      if (typeof document === 'undefined') return () => {}
      for (const stale of document.querySelectorAll('style[data-plugin-css=' + JSON.stringify(SCROLL_STYLE_ID) + ']')) {
        stale.remove()
      }
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-sidebar-enhance'
      tag.dataset.pluginCss = SCROLL_STYLE_ID
      tag.textContent = SCROLL_CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /**
     * Keep a real spacer as the guide's last flex child.
     *
     * The guide's own `:after` spacer is a shrinkable flex item: once the cards
     * are taller than the pane it collapses to zero, so scrolling to the end
     * leaves the last card flush against the panel edge. A generated
     * pseudo-element with a fixed basis is not counted in the guide's
     * scrollable overflow either (the same is true of a bottom margin on the
     * last card), while a real child is. Twenty-four pixels plus the guide's
     * 14px row gap gives about 38px of breathing room under the last card.
     */
    function ensureBottomSpacers() {
      if (typeof document === 'undefined') return
      for (const guide of document.querySelectorAll('[data-sidebar-right-session] [data-sidebar-right-guide]')) {
        let spacer = guide.querySelector(':scope > [' + SPACER_ATTR + ']')
        if (spacer === null) {
          spacer = document.createElement('div')
          spacer.setAttribute(SPACER_ATTR, '')
          guide.appendChild(spacer)
        } else if (guide.lastElementChild !== spacer) {
          // React inserted a card after the spacer; move it back to the end.
          guide.appendChild(spacer)
        }
      }
    }

    /**
     * Watch the right Sidebar and keep the guide's bottom spacer in place.
     *
     * React owns the guide's children, so a rerender can append after the
     * spacer or replace it; the child-list observer re-asserts the order on the
     * next frame. The observer is frame-throttled, so streaming messages do not
     * cost a scan per DOM mutation.
     * @returns {() => void} Stop watching and remove the spacers.
     */
    function installBottomSpacer() {
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {}
      let frameRequest = 0
      let disposed = false
      const schedule = () => {
        if (frameRequest !== 0) return
        frameRequest = window.requestAnimationFrame(() => {
          frameRequest = 0
          if (!disposed) ensureBottomSpacers()
        })
      }
      const observer = new MutationObserver(schedule)
      observer.observe(document.documentElement, { subtree: true, childList: true })
      schedule()
      return () => {
        disposed = true
        observer.disconnect()
        if (frameRequest !== 0) {
          window.cancelAnimationFrame(frameRequest)
          frameRequest = 0
        }
        for (const spacer of document.querySelectorAll('[' + SPACER_ATTR + ']')) spacer.remove()
      }
    }

    // #region width guard internals

    /**
     * The frame grid that both columns live in. `[data-rightbar-col]` is a
     * stable attribute the layout package puts on the third column; its parent
     * is the grid container whose `grid-template-columns` the frame writes.
     * @returns {HTMLElement | null} The frame element, when the app is mounted.
     */
    function findFrame() {
      const column = document.querySelector('[data-rightbar-col]')
      return column === null ? null : column.parentElement
    }

    /**
     * Read the left column's used width from the frame's resolved track list.
     * The computed value is a list of used pixels (e.g. `280px 840px 320px`),
     * which is exactly the split the frame drew.
     * @param {HTMLElement} frame - the grid container.
     * @returns {number} the sidebar width in px, `0` when it cannot be read.
     */
    function readSidebarWidth(frame) {
      const template = window.getComputedStyle(frame).gridTemplateColumns
      const first = template === undefined || template === '' ? '' : template.trim().split(/\s+/)[0]
      const value = Number.parseFloat(first)
      return Number.isFinite(value) && value > 0 ? value : 0
    }

    /**
     * Solve the first-open width: one third of the frame minus the left column.
     *
     * The conversation `C` is the frame minus both side columns, so the request
     * `R ≤ (R + C) / 3` is `R ≤ (frameWidth − sidebarWidth) / 3`. The column's
     * contract floor wins only on frames too narrow for a third to reach it.
     * @param {HTMLElement} frame - the grid container.
     * @returns {number} a whole-pixel target width.
     */
    function computeTargetWidth(frame) {
      const measured = frame.getBoundingClientRect().width
      const frameWidth = Number.isFinite(measured) && measured > 0 ? measured : window.innerWidth
      const available = Math.max(0, frameWidth - readSidebarWidth(frame))
      return Math.max(RIGHTBAR_MIN, Math.floor(available / 3))
    }

    /**
     * Read the width the Sidebar panel was rendered with.
     *
     * The panel writes its width inline (`width: <px>`), which is the layout
     * store's resolved normal width and is available before the transition
     * finishes; the bounding box is the fallback.
     * @param {HTMLElement} panel - the `[data-sidebar-right-panel]` element.
     * @returns {number} the width in px, or `NaN` when unreadable.
     */
    function readPanelWidth(panel) {
      const inline = Number.parseFloat(panel.style === undefined ? '' : panel.style.width)
      if (Number.isFinite(inline) && inline > 0) return inline
      const measured = panel.getBoundingClientRect().width
      return Number.isFinite(measured) ? measured : Number.NaN
    }

    /**
     * Reach the frame component's bound layout actions through the React fiber
     * attached to its DOM node, and call the same `setRightbar` the built-in
     * resize handle calls.
     *
     * React 18 attaches `__reactFiber$…` to every host node for its event
     * system. Walking up from the frame element reaches `AppFrame`, whose props
     * carry the root store's bound action set. This is deliberately the first
     * route: it lands the width in the store before the panel is painted.
     * @param {HTMLElement} frame - the frame element.
     * @param {number} px - target width.
     * @returns {boolean} whether an action was found and called.
     */
    function setWidthThroughFiber(frame, px) {
      if (frame === null || frame === undefined) return false
      let fiber
      for (const key of Object.keys(frame)) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
          fiber = frame[key]
          break
        }
      }
      if (fiber === undefined || fiber === null) return false
      let node = fiber
      for (let depth = 0; node !== null && node !== undefined && depth < 80; depth += 1) {
        const props = node.memoizedProps
        const actions = props === null || props === undefined ? undefined : props.actions
        if (actions !== null && actions !== undefined && typeof actions.setRightbar === 'function') {
          try {
            actions.setRightbar(px)
            return true
          } catch (error) {
            // A disposed store (bundle reload raced the commit) is a fallback,
            // not a failure: the handle route may still reach a live frame.
            console.warn('[dsh-sidebar-enhance] layout action refused the width', error)
            return false
          }
        }
        node = node.return
      }
      return false
    }

    /**
     * Fallback route: drive the product's own right-handle resize through the
     * public pointer-event path.
     *
     * The handle records the drag origin on pointer-down and applies
     * `base − (upX − downX)` on pointer-up. A synthetic pair that moves right by
     * `base − target` therefore lands the store at the target width. Pointer
     * capture is stubbed on the element because no real pointer is active.
     * @param {HTMLElement} panel - the `[data-sidebar-right-panel]` element.
     * @param {number} px - target width.
     * @returns {boolean} whether the drag was dispatched.
     */
    function setWidthThroughHandle(panel, px) {
      if (typeof window.PointerEvent !== 'function') return false
      const handle = document.querySelector('[data-side="rightbar"]')
      if (handle === null) return false
      const base = readPanelWidth(panel)
      if (!Number.isFinite(base) || base <= 0) return false
      const distance = Math.round(base - px)
      if (distance <= 0) return true
      const rect = handle.getBoundingClientRect()
      const originX = rect.left + rect.width / 2
      const originY = rect.top + rect.height / 2
      const pointerId = 1
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: originX,
        clientY: originY,
        pointerId,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 1,
      }
      try {
        handle.setPointerCapture = () => {}
        handle.hasPointerCapture = () => false
        handle.releasePointerCapture = () => {}
        handle.dispatchEvent(new window.PointerEvent('pointerdown', init))
        handle.dispatchEvent(new window.PointerEvent('pointerup', { ...init, clientX: originX + distance, buttons: 0 }))
        return true
      } catch (error) {
        console.warn('[dsh-sidebar-enhance] could not resize the right Sidebar through its handle', error)
        return false
      }
    }

    /**
     * Make one open right-Sidebar panel obey the one-third rule.
     * @param {HTMLElement} panel - the open `[data-sidebar-right-panel]` element.
     * @returns {boolean} whether the width is now (or already was) within the rule.
     */
    function applyWidthCap(panel) {
      const frame = findFrame()
      if (frame === null) return false
      const target = computeTargetWidth(frame)
      if (!Number.isFinite(target) || target <= 0) return false
      const current = readPanelWidth(panel)
      if (Number.isFinite(current) && current > 0 && current <= target + WIDTH_TOLERANCE) return true
      if (setWidthThroughFiber(frame, target)) return true
      return setWidthThroughHandle(panel, target)
    }

    // #endregion

    // #region width guard component

    /**
     * Watch the right Sidebar and cap the first opening of each Session.
     *
     * A Session's panel exists — collapsed — from the moment the Session view is
     * rendered, and it gains `data-sidebar-right-open` when the user opens it.
     * The observer therefore sees the first click whether the click came from
     * the conversation-header button, a file link, a guide card, or a command.
     * Ids are remembered in memory only: closing the bundle (or restarting the
     * app) resets the list, which is exactly the "new app launch" case.
     * @returns {() => void} Stop watching.
     */
    function installWidthGuard() {
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {}

      /** Sessions whose panel already opened once since this app started. */
      const handled = new Set()
      /** Sessions whose cap is being applied right now, so retries stay single. */
      const pending = new Set()
      let disposed = false
      let frameRequest = 0

      /**
       * Try to cap one panel until it succeeds, closes, or runs out of attempts.
       * @param {HTMLElement} panel - the panel element observed as open.
       * @param {string} sessionId - that panel's Session id.
       */
      const cap = (panel, sessionId) => {
        if (pending.has(sessionId)) return
        pending.add(sessionId)
        let attempts = 0
        const attempt = () => {
          if (disposed || !panel.isConnected) {
            pending.delete(sessionId)
            return
          }
          if (panel.getAttribute('data-sidebar-right-panel') !== 'push' || panel.getAttribute('data-sidebar-right-open') === null) {
            pending.delete(sessionId)
            return
          }
          if (applyWidthCap(panel)) {
            handled.add(sessionId)
            pending.delete(sessionId)
            return
          }
          attempts += 1
          if (attempts >= MAX_ATTEMPTS) {
            pending.delete(sessionId)
            console.warn('[dsh-sidebar-enhance] could not cap the right Sidebar width for Session', sessionId)
            return
          }
          window.setTimeout(attempt, RETRY_MS)
        }
        attempt()
      }

      /** Find panels that just entered the open push state and cap the new ones. */
      const scan = () => {
        frameRequest = 0
        if (disposed) return
        const panels = document.querySelectorAll('[data-sidebar-right-session][data-sidebar-right-panel]')
        for (const panel of panels) {
          if (panel.getAttribute('data-sidebar-right-panel') !== 'push') continue
          if (!panel.hasAttribute('data-sidebar-right-open')) continue
          // A retained background Session keeps its subtree mounted but hidden.
          if (panel.closest('[hidden], [aria-hidden="true"]') !== null) continue
          const sessionId = panel.getAttribute('data-sidebar-right-session')
          if (sessionId === null || sessionId === '' || handled.has(sessionId) || pending.has(sessionId)) continue
          cap(panel, sessionId)
        }
      }

      /** Coalesce mutation bursts into one frame of work. */
      const schedule = () => {
        if (frameRequest !== 0) return
        frameRequest = window.requestAnimationFrame(scan)
      }

      const observer = new MutationObserver(schedule)
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-sidebar-right-open', 'data-sidebar-right-panel', 'hidden'],
      })
      // The app can restore an already-open panel while the bundle is loading.
      schedule()
      return () => {
        disposed = true
        observer.disconnect()
        if (frameRequest !== 0) {
          window.cancelAnimationFrame(frameRequest)
          frameRequest = 0
        }
      }
    }

    /** Component 1: cap the right Sidebar's first-open width for every Session. */
    function SidebarWidthGuard() {
      React.useEffect(() => installWidthGuard(), [])
      return null
    }

    // #endregion

    // #region scroll component

    /** Component 2: let every right-Sidebar page scroll, with a visible thumb and bottom room. */
    function SidebarScrollEnhancer() {
      React.useEffect(() => {
        const disposeStyles = installScrollStyles()
        const disposeSpacer = installBottomSpacer()
        return () => {
          disposeSpacer()
          disposeStyles()
        }
      }, [])
      return null
    }

    // #endregion

    // #region plugin

    /**
     * @param {import('@deepseek-ai/cordis').Context} ctx - Client context.
     */
    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: WIDTH_ID,
          order: 120,
        }, SidebarWidthGuard)),
        'dsh-sidebar-enhance: first-open width guard',
      )

      ctx.effect(
        () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: SCROLL_ID,
          order: 121,
        }, SidebarScrollEnhancer)),
        'dsh-sidebar-enhance: vertical scroll',
      )
    }

    const plugin = {
      inject: ['slots'],
      apply,
    }

    // The bundle's checks read these without going through the UI; they are not
    // part of the plugin contract and are non-enumerable so nothing serializes
    // them into Plugin Manager state.
    Object.defineProperty(plugin, 'internals', {
      enumerable: false,
      value: {
        SCROLL_STYLE_ID,
        SPACER_ATTR,
        computeTargetWidth,
        readPanelWidth,
        readSidebarWidth,
        applyWidthCap,
        setWidthThroughFiber,
        setWidthThroughHandle,
        installScrollStyles,
        ensureBottomSpacers,
        installBottomSpacer,
      },
    })

    return plugin
  },
})
