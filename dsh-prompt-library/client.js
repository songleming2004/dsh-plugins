/**
 * Prompt library — a tab type in the right Sidebar, plus a shortcut on the New Session row.
 *
 * Four public extension points are used:
 *
 * 1. `ctx.sidebarRightTabs.register({ id, kind, title, guide })` declares the tab type and the
 *    card the right Sidebar's guide page shows for it (owned by `@deepseek-ai/dsh-client-ui-sidebar-right`).
 * 2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id })` registers the body, which
 *    receives the session standard props (`inputActions` is the composer face).
 * 3. `ctx.slots.register({ name: 'conversation.hero.options', id })` adds the compact trigger the
 *    New Session row carries beside the workspace and preset controls — the row a blank
 *    conversation shows above its composer.
 * 4. `ctx.slots.register({ name: 'shell.overlay', id })` draws the menu that trigger opens. The
 *    frame-wide layer sits above every column, so the list is never clipped by the row.
 *
 * The prompts themselves live in this browser's localStorage under one key, shared by every open
 * occurrence of the tab and by the menu, so an edit anywhere is visible everywhere.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-library',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of every user-visible string this plugin renders. */
    const NS = 'dsh-prompt-library'
    /** Implementation id: the tab type's identity and the key its body registers under. */
    const ID = '@local/dsh-prompt-library'
    /** Cell id of the New Session trigger and of the overlay menu it opens. */
    const MENU_ID = '@local/dsh-prompt-library:prompt-menu'
    /** Kind the guide card opens by. */
    const KIND = 'dsh-prompt-library'
    /** Place of the guide card among the other products' cards. */
    const GUIDE_ORDER = 15
    /** One browser-local document for the whole prompt library. */
    const STORAGE_KEY = 'dsh.prompt-library.v1'

    const zh = {
      tabTitle: '常用提示词',
      guideDescription: '一键插入常用提示词',
      search: '搜索提示词',
      create: '新建',
      edit: '编辑',
      copy: '复制',
      remove: '删除',
      confirmDelete: '确定要删除这条提示词吗？',
      deleteAction: '删除',
      save: '保存',
      cancel: '取消',
      titleLabel: '标题',
      titlePlaceholder: '给这条提示词起个名字',
      contentPlaceholder: '输入提示词内容，选中卡片时会插入到输入框光标处',
      empty: '还没有提示词，点「新建」写下第一条。',
      emptySearch: '没有匹配的提示词。',
      hint: '点击卡片插入到输入框，右侧按钮可编辑或删除。',
      inserted: '已插入到输入框',
      heroButton: '提示词',
      menuAria: '选择要插入的常用提示词',
      menuEmpty: '还没有提示词。在右侧栏的「常用提示词」里添加。',
      insertFailed: '无法插入到输入框',
      copied: '已复制到剪贴板',
      copyFailed: '复制失败，请手动选择文本',
      saved: '已保存',
      removed: '已删除',
      contentRequired: '提示词内容不能为空',
      newPromptTitle: '未命名提示词',
      countPrefix: '共 ',
      countSuffix: ' 条',
    }

    const en = {
      tabTitle: 'Prompt library',
      guideDescription: 'Insert a saved prompt in one click',
      search: 'Search prompts',
      create: 'New',
      edit: 'Edit',
      copy: 'Copy',
      remove: 'Delete',
      confirmDelete: 'Delete this prompt?',
      deleteAction: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      titleLabel: 'Title',
      titlePlaceholder: 'Name this prompt',
      contentPlaceholder: 'Write the prompt; picking the card inserts it at the composer caret',
      empty: 'No prompts yet. Choose “New” to add the first one.',
      emptySearch: 'No prompt matches that search.',
      hint: 'Pick a card to insert it into the composer; the buttons on the right edit or delete it.',
      inserted: 'Inserted into the composer',
      heroButton: 'Prompts',
      menuAria: 'Choose a saved prompt to insert',
      menuEmpty: 'No prompts yet. Add them in the Prompt library tab.',
      insertFailed: 'Could not insert into the composer',
      copied: 'Copied to the clipboard',
      copyFailed: 'Copy failed; select the text manually',
      saved: 'Saved',
      removed: 'Deleted',
      contentRequired: 'The prompt text cannot be empty',
      newPromptTitle: 'Untitled prompt',
      countPrefix: '',
      countSuffix: ' prompts',
    }

    /** Every locale the Web app ships, so a non-English, non-Chinese UI still reads English. */
    const DICT_LOCALES = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']
    const dictionaries = {}
    for (const locale of DICT_LOCALES) dictionaries[locale] = en
    dictionaries.zh = zh

    /** Starter prompts so the panel is useful before the user writes anything. */
    const DEFAULTS = [
      {
        title: '代码审查',
        content: '请审查下面这段代码，指出潜在的 bug、性能问题和可读性问题，并给出具体的修改建议：\n\n',
      },
      {
        title: '补充单元测试',
        content: '为下面的代码补充单元测试，覆盖正常路径与边界情况，并保持与项目现有测试风格一致：\n\n',
      },
      {
        title: '解释代码',
        content: '请逐步解释下面这段代码的作用、关键流程和潜在的坑：\n\n',
      },
      {
        title: '精简重写',
        content: '请在不改变含义的前提下精简并重写下面这段文字，保持专业、准确、简洁：\n\n',
      },
    ]

    //#region storage

    /**
     * @returns {string} A collision-free prompt identity.
     */
    function makeId() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID()
        }
      } catch {
        // Fall through to the arithmetic form below.
      }
      return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    /**
     * @param {string} content - Prompt text.
     * @returns {string} The first non-empty line, clipped, used when a prompt has no title.
     */
    function titleFromContent(content) {
      const line = content.split('\n').map((part) => part.trim()).find((part) => part !== '')
      if (line === undefined) return ''
      return line.length > 40 ? line.slice(0, 40) + '…' : line
    }

    /**
     * Adopt one stored document, dropping entries this version cannot render.
     * @param {unknown} raw - Parsed JSON from storage.
     * @returns {{ version: number, prompts: object[] } | null} A usable document, or null.
     */
    function normalizeDoc(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const list = Array.isArray(raw.prompts) ? raw.prompts : null
      if (list === null) return null
      const prompts = []
      const taken = new Set()
      for (const item of list) {
        if (item === null || typeof item !== 'object') continue
        const content = typeof item.content === 'string' ? item.content : ''
        if (content.trim() === '') continue
        let id = typeof item.id === 'string' && item.id !== '' && !taken.has(item.id) ? item.id : makeId()
        taken.add(id)
        const title = typeof item.title === 'string' && item.title.trim() !== ''
          ? item.title.trim()
          : titleFromContent(content)
        prompts.push({
          id,
          title,
          content,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        })
      }
      return { version: 1, prompts }
    }

    /**
     * @returns {{ version: number, prompts: object[] }} The starter library.
     */
    function seedDoc() {
      const now = Date.now()
      return {
        version: 1,
        prompts: DEFAULTS.map((entry, index) => ({
          id: makeId(),
          title: entry.title,
          content: entry.content,
          createdAt: now - index,
          updatedAt: now - index,
        })),
      }
    }

    /**
     * @returns {{ version: number, prompts: object[] }} The library this browser holds.
     */
    function loadDoc() {
      let stored = null
      try {
        stored = window.localStorage.getItem(STORAGE_KEY)
      } catch {
        return seedDoc()
      }
      if (stored === null) return seedDoc()
      let parsed = null
      try {
        parsed = JSON.parse(stored)
      } catch {
        return seedDoc()
      }
      return normalizeDoc(parsed) ?? seedDoc()
    }

    let cachedDoc = null
    const listeners = new Set()

    /**
     * @returns {{ version: number, prompts: object[] }} The shared, reference-stable document.
     */
    function currentDoc() {
      if (cachedDoc === null) cachedDoc = loadDoc()
      return cachedDoc
    }

    /**
     * @param {(doc: object) => object} mutate - Pure producer of the next document.
     */
    function editDoc(mutate) {
      const next = mutate(currentDoc())
      if (next === null || typeof next !== 'object') return
      cachedDoc = next
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // A full or disabled store keeps the in-memory library usable for this page.
      }
      for (const listener of [...listeners]) listener()
    }

    /**
     * @param {() => void} listener - Invalidation callback.
     * @returns {() => void} Unsubscribe.
     */
    function subscribeDoc(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    /**
     * @returns {{ version: number, prompts: object[] }} The library, re-rendering on every edit.
     */
    function useDoc() {
      const [doc, setDoc] = React.useState(currentDoc)
      React.useEffect(() => {
        setDoc(currentDoc())
        return subscribeDoc(() => setDoc(currentDoc()))
      }, [])
      return doc
    }

    //#endregion

    //#region composer bridge

    /**
     * Insert text at the composer caret through the public InputActions face.
     * @param {object | undefined} inputActions - Session standard prop.
     * @param {string} text - Prompt text.
     * @returns {boolean} Whether the composer accepted the insertion.
     */
    function insertIntoComposer(inputActions, text) {
      if (inputActions === undefined || inputActions === null) return false
      if (typeof inputActions.captureInsertion !== 'function') return false
      if (typeof inputActions.insertText !== 'function') return false
      try {
        const span = inputActions.captureInsertion()
        if (span === undefined || span === null) return false
        return inputActions.insertText(text, span) === true
      } catch {
        return false
      }
    }

    /**
     * @param {string} text - Text to copy.
     * @returns {boolean} Whether a copy was handed to the browser.
     */
    function copyText(text) {
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          void navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        // Fall through to the selection-based path.
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const copied = document.execCommand('copy')
        area.remove()
        return copied === true
      } catch {
        return false
      }
    }

    //#endregion

    //#region new-session menu

    /** Width of the prompt menu, in pixels. */
    const MENU_WIDTH = 248
    /** Tallest the menu grows before its list scrolls. */
    const MENU_MAX_HEIGHT = 320
    /** Distance between the trigger and the menu. */
    const MENU_GAP = 6
    /** Space the menu keeps from every viewport edge. */
    const MENU_INSET = 8
    /** Room below the trigger needed to open downwards instead of upwards. */
    const MENU_MIN_BELOW = 168

    /**
     * The prompt menu opens from a compact control in the New Session row and is drawn by the
     * frame-wide overlay, which is a different render subtree with no composer props. This
     * module-level store carries the trigger geometry and the insertion target across that
     * boundary, the same way the library document is shared with the sidebar tab.
     * @type {null | { anchorEl: Element, rect: { top: number, bottom: number, right: number }, insert: (content: string) => boolean }}
     */
    let promptMenu = null
    const promptMenuListeners = new Set()

    /**
     * @param {null | object} next - The menu to show, or null to close it.
     */
    function setPromptMenu(next) {
      promptMenu = next
      for (const listener of [...promptMenuListeners]) listener()
    }

    /**
     * @param {() => void} listener - Invalidation callback.
     * @returns {() => void} Unsubscribe.
     */
    function subscribePromptMenu(listener) {
      promptMenuListeners.add(listener)
      return () => {
        promptMenuListeners.delete(listener)
      }
    }

    /**
     * @returns {null | object} The open menu, re-rendering on every open and close.
     */
    function usePromptMenu() {
      const [state, setState] = React.useState(promptMenu)
      React.useEffect(() => {
        setState(promptMenu)
        return subscribePromptMenu(() => setState(promptMenu))
      }, [])
      return state
    }

    /**
     * Place the menu under the trigger, flipping above it and clamping it inside the viewport.
     * @param {{ top: number, bottom: number, right: number }} rect - The trigger's client rect.
     * @returns {{ left: number, top?: number, bottom?: number, maxHeight: number }} Fixed-position style.
     */
    function menuGeometry(rect) {
      const vw = window.innerWidth || 0
      const vh = window.innerHeight || 0
      const below = vh - rect.bottom - MENU_GAP - MENU_INSET
      const above = rect.top - MENU_GAP - MENU_INSET
      const flip = below < MENU_MIN_BELOW && above > below
      const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, flip ? above : below))
      const highest = Math.max(MENU_INSET, vw - MENU_WIDTH - MENU_INSET)
      const left = Math.min(Math.max(rect.right - MENU_WIDTH, MENU_INSET), highest)
      return flip
        ? { left, bottom: vh - rect.top + MENU_GAP, maxHeight }
        : { left, top: rect.bottom + MENU_GAP, maxHeight }
    }

    /**
     * The compact control the New Session row carries; it opens the menu for the composer below it.
     * @param {{ t: Function, inputActions?: object }} props - Seat props plus this plugin's translate function.
     */
    function HeroPromptButton({ t, inputActions }) {
      const state = usePromptMenu()
      const buttonRef = React.useRef(null)
      const open = state !== null

      React.useEffect(() => () => {
        // The New Session row disappears once the conversation starts; close with it.
        if (promptMenu !== null && !document.contains(promptMenu.anchorEl)) setPromptMenu(null)
      }, [])

      const toggle = () => {
        if (promptMenu !== null) {
          setPromptMenu(null)
          return
        }
        const el = buttonRef.current
        if (el === null) return
        const rect = el.getBoundingClientRect()
        setPromptMenu({
          anchorEl: el,
          rect: { top: rect.top, bottom: rect.bottom, right: rect.right },
          insert: (content) => insertIntoComposer(inputActions, content),
        })
      }

      return h(
        'button',
        {
          ref: buttonRef,
          type: 'button',
          className: 'dshpl-hero',
          'data-dshpl-anchor': 'true',
          title: t('heroButton'),
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          onClick: toggle,
        },
        h(LibraryGlyph, { size: 14 }),
        h('span', {}, t('heroButton')),
      )
    }

    /**
     * The open menu itself, in the frame-wide overlay.
     * @param {{ state: object, t: Function }} props - The open menu and this plugin's translate function.
     */
    function PromptMenu({ state, t }) {
      const doc = useDoc()
      const [error, setError] = React.useState(null)
      const rootRef = React.useRef(null)
      const firstRef = React.useRef(null)

      React.useEffect(() => {
        if (firstRef.current !== null) firstRef.current.focus()
      }, [])

      React.useEffect(() => {
        const inside = (target) => {
          const root = rootRef.current
          return root !== null && target instanceof Node && root.contains(target)
        }
        const onPointerDown = (event) => {
          if (inside(event.target)) return
          if (event.target instanceof Element && event.target.closest('[data-dshpl-anchor]') !== null) return
          setPromptMenu(null)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          const el = state.anchorEl
          setPromptMenu(null)
          if (el !== null && el !== undefined && typeof el.focus === 'function') el.focus()
        }
        const onScroll = (event) => {
          if (inside(event.target)) return
          setPromptMenu(null)
        }
        const onResize = () => setPromptMenu(null)

        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onResize)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onResize)
        }
      }, [state])

      const pick = (prompt) => {
        if (state.insert(prompt.content)) {
          setPromptMenu(null)
          return
        }
        if (copyText(prompt.content)) {
          setPromptMenu(null)
          return
        }
        setError(t('insertFailed'))
      }

      const placement = menuGeometry(state.rect)
      const style = {
        width: MENU_WIDTH + 'px',
        maxHeight: placement.maxHeight + 'px',
        left: placement.left + 'px',
      }
      if (placement.top === undefined) style.bottom = placement.bottom + 'px'
      else style.top = placement.top + 'px'

      const rows = doc.prompts.length === 0
        ? [h('div', { className: 'dshpl-menu-empty', key: 'empty' }, t('menuEmpty'))]
        : doc.prompts.map((prompt, index) => h(
          'button',
          {
            key: prompt.id,
            ref: index === 0 ? firstRef : undefined,
            type: 'button',
            role: 'menuitem',
            className: 'dshpl-menu-item',
            onClick: () => pick(prompt),
          },
          h('span', { className: 'dshpl-menu-title' }, prompt.title),
        ))

      return h(
        'div',
        {
          ref: rootRef,
          className: 'dshpl-menu',
          role: 'menu',
          'aria-label': t('menuAria'),
          style,
        },
        rows,
        error === null
          ? null
          : h('div', { className: 'dshpl-menu-error', role: 'status' }, error),
      )
    }

    /**
     * The overlay half of the menu: mounted once by the frame-wide layer, renders only when open.
     * @param {{ t: Function }} props - This plugin's translate function.
     */
    function PromptMenuOverlay({ t }) {
      const state = usePromptMenu()
      if (state === null) return null
      return h(PromptMenu, { state, t })
    }

    //#endregion

    //#region artwork

    /**
     * The library glyph: stacked lines with a starred card.
     * @param {{ size?: number, className?: string }} props - Glyph sizing.
     */
    function LibraryGlyph({ size = 22, className }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className,
          'aria-hidden': true,
        },
        h('path', { d: 'M5 4.5h9.5' }),
        h('path', { d: 'M5 8.5h12' }),
        h('path', { d: 'M5 12.5h7' }),
        h('path', {
          d: 'M17.2 13.4l1.05 2.1 2.3.28-1.72 1.57.44 2.35-2.07-1.19-2.07 1.19.44-2.35-1.72-1.57 2.3-.28z',
          fill: 'currentColor',
          stroke: 'none',
        }),
      )
    }

    /**
     * @param {{ size?: number, className?: string }} props - Glyph sizing.
     */
    function PencilGlyph({ size = 14, className }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className,
          'aria-hidden': true,
        },
        h('path', { d: 'M4 20l4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z' }),
        h('path', { d: 'M13.5 6.5l4 4' }),
      )
    }

    /**
     * @param {{ size?: number, className?: string }} props - Glyph sizing.
     */
    function CopyGlyph({ size = 14, className }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className,
          'aria-hidden': true,
        },
        h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2.4 }),
        h('path', { d: 'M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A2.5 2.5 0 0 0 4 5.5v7A2.5 2.5 0 0 0 6.5 15' }),
      )
    }

    /**
     * @param {{ size?: number, className?: string }} props - Glyph sizing.
     */
    function TrashGlyph({ size = 14, className }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className,
          'aria-hidden': true,
        },
        h('path', { d: 'M4.5 6.5h15' }),
        h('path', { d: 'M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7' }),
        h('path', { d: 'M6.5 6.5l.9 12.1c.06.8.72 1.4 1.5 1.4h6.2c.78 0 1.44-.6 1.5-1.4l.9-12.1' }),
      )
    }

    //#endregion

    //#region styles

    const STYLE_TEXT = `
.dshpl-root {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.45;
}
.dshpl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
}
.dshpl-search {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  font: inherit;
  outline: none;
}
.dshpl-search::placeholder { color: var(--dsw-alias-label-secondary); }
.dshpl-search:focus-visible { border-color: var(--dsw-alias-brand-primary); }
.dshpl-new {
  flex: none;
  height: 28px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.dshpl-new:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshpl-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dshpl-card {
  display: flex;
  align-items: stretch;
  gap: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1);
}
.dshpl-card:hover { border-color: var(--dsw-alias-border-l2); }
.dshpl-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshpl-card-main:hover { background: var(--dsw-alias-bg-layer-2); }
.dshpl-card-main:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dshpl-card-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpl-card-body {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  white-space: pre-wrap;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.dshpl-card-actions {
  flex: none;
  display: flex;
  align-items: center;
  padding-right: 4px;
}
.dshpl-icon {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshpl-icon:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshpl-icon:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshpl-icon[data-danger="true"] { color: var(--dsw-alias-state-error-primary); }
.dshpl-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-brand-primary);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1);
}
.dshpl-editor-title,
.dshpl-editor-content {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-base);
  color: inherit;
  font: inherit;
  outline: none;
  resize: vertical;
}
.dshpl-editor-title:focus-visible,
.dshpl-editor-content:focus-visible { border-color: var(--dsw-alias-brand-primary); }
.dshpl-editor-content { min-height: 92px; }
.dshpl-editor-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dshpl-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}
.dshpl-button {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}
.dshpl-button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshpl-button[data-primary="true"] {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: #ffffff;
}
.dshpl-button[data-danger="true"] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}
.dshpl-button:disabled { opacity: 0.5; cursor: default; }
.dshpl-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-sm, 8px);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
.dshpl-confirm-actions {
  flex: none;
  display: flex;
  gap: 6px;
}
.dshpl-empty {
  padding: 24px 8px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}
.dshpl-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dshpl-notice {
  flex: none;
  padding: 0 12px 8px;
  color: var(--dsw-alias-state-success-primary);
  font-size: 12px;
}
.dshpl-notice[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dshpl-hero {
  flex: none;
  height: 26px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.dshpl-hero:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dshpl-hero:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dshpl-hero[aria-expanded="true"] {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dshpl-menu {
  position: fixed;
  z-index: 60;
  box-sizing: border-box;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 30px rgb(0 0 0 / 16%);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.35;
}
.dshpl-menu-item {
  flex: none;
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshpl-menu-item:hover { background: var(--dsw-alias-bg-layer-2); }
.dshpl-menu-item:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
.dshpl-menu-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpl-menu-empty {
  padding: 10px 9px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.dshpl-menu-error {
  margin-top: 4px;
  padding: 6px 9px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
.dshpl-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`

    //#endregion

    //#region components

    /**
     * One prompt's read mode.
     * @param {{ prompt: object, t: Function, onInsert: Function, onEdit: Function, onCopy: Function, onRemove: Function }} props
     */
    function PromptCard({ prompt, t, onInsert, onEdit, onCopy, onRemove }) {
      const preview = prompt.content.trim()
      return h(
        'div',
        { className: 'dshpl-card' },
        h(
          'button',
          {
            type: 'button',
            className: 'dshpl-card-main',
            title: preview.length > 400 ? preview.slice(0, 400) + '…' : preview,
            onClick: () => onInsert(prompt),
          },
          h('span', { className: 'dshpl-card-title' }, prompt.title),
          h('span', { className: 'dshpl-card-body' }, preview),
        ),
        h(
          'div',
          { className: 'dshpl-card-actions' },
          h(
            'button',
            { type: 'button', className: 'dshpl-icon', title: t('edit'), 'aria-label': t('edit'), onClick: () => onEdit(prompt) },
            h(PencilGlyph, {}),
          ),
          h(
            'button',
            { type: 'button', className: 'dshpl-icon', title: t('copy'), 'aria-label': t('copy'), onClick: () => onCopy(prompt) },
            h(CopyGlyph, {}),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshpl-icon',
              'data-danger': 'true',
              title: t('remove'),
              'aria-label': t('remove'),
              onClick: () => onRemove(prompt),
            },
            h(TrashGlyph, {}),
          ),
        ),
      )
    }

    /**
     * Title and text of one prompt, new or existing.
     * @param {{ draft: object, t: Function, onChange: Function, onSave: Function, onCancel: Function }} props
     */
    function PromptEditor({ draft, t, onChange, onSave, onCancel }) {
      const titleRef = React.useRef(null)
      React.useEffect(() => {
        if (titleRef.current !== null) titleRef.current.focus()
      }, [])
      const save = () => onSave(draft)
      return h(
        'div',
        { className: 'dshpl-editor' },
        h('span', { className: 'dshpl-editor-label' }, t('titleLabel')),
        h('input', {
          ref: titleRef,
          className: 'dshpl-editor-title',
          value: draft.title,
          placeholder: t('titlePlaceholder'),
          maxLength: 120,
          onChange: (event) => onChange({ ...draft, title: event.target.value }),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              save()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          },
        }),
        h('textarea', {
          className: 'dshpl-editor-content',
          value: draft.content,
          placeholder: t('contentPlaceholder'),
          onChange: (event) => onChange({ ...draft, content: event.target.value }),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              save()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          },
        }),
        h(
          'div',
          { className: 'dshpl-editor-actions' },
          h('button', { type: 'button', className: 'dshpl-button', onClick: onCancel }, t('cancel')),
          h('button', { type: 'button', className: 'dshpl-button', 'data-primary': 'true', onClick: save }, t('save')),
        ),
      )
    }

    /**
     * The tab body.
     * @param {{ t: Function, inputActions?: object }} props - Seat props plus this plugin's translate function.
     */
    function PromptLibraryBody({ t, inputActions }) {
      const doc = useDoc()
      const [query, setQuery] = React.useState('')
      const [draft, setDraft] = React.useState(null)
      const [confirmId, setConfirmId] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const timer = React.useRef(0)

      const flash = React.useCallback((text, tone) => {
        setNotice({ text, tone: tone ?? 'info' })
      }, [])

      React.useEffect(() => {
        if (notice === null) return undefined
        const handle = window.setTimeout(() => setNotice(null), 2600)
        timer.current = handle
        return () => window.clearTimeout(handle)
      }, [notice])

      React.useEffect(() => () => window.clearTimeout(timer.current), [])

      const prompts = doc.prompts
      const needle = query.trim().toLowerCase()
      const visible = needle === ''
        ? prompts
        : prompts.filter((prompt) =>
          prompt.title.toLowerCase().includes(needle) || prompt.content.toLowerCase().includes(needle))

      const insert = (prompt) => {
        setConfirmId(null)
        if (insertIntoComposer(inputActions, prompt.content)) {
          flash(t('inserted'), 'ok')
          return
        }
        if (copyText(prompt.content)) flash(t('copied'), 'ok')
        else flash(t('copyFailed'), 'error')
      }

      const copy = (prompt) => {
        setConfirmId(null)
        if (copyText(prompt.content)) flash(t('copied'), 'ok')
        else flash(t('copyFailed'), 'error')
      }

      const startCreate = () => {
        setConfirmId(null)
        setDraft({ id: null, title: '', content: '' })
      }

      const startEdit = (prompt) => {
        setConfirmId(null)
        setDraft({ id: prompt.id, title: prompt.title, content: prompt.content })
      }

      const save = (candidate) => {
        const content = candidate.content.trim()
        if (content === '') {
          flash(t('contentRequired'), 'error')
          return
        }
        const title = candidate.title.trim() === '' ? titleFromContent(content) || t('newPromptTitle') : candidate.title.trim()
        const now = Date.now()
        if (candidate.id === null) {
          editDoc((current) => ({
            version: 1,
            prompts: [{ id: makeId(), title, content, createdAt: now, updatedAt: now }, ...current.prompts],
          }))
        } else {
          editDoc((current) => ({
            version: 1,
            prompts: current.prompts.map((prompt) =>
              prompt.id === candidate.id ? { ...prompt, title, content, updatedAt: now } : prompt),
          }))
        }
        setDraft(null)
        flash(t('saved'), 'ok')
      }

      const remove = (prompt) => {
        setConfirmId(prompt.id)
      }

      const confirmRemove = () => {
        const target = prompts.find((prompt) => prompt.id === confirmId)
        setConfirmId(null)
        if (target === undefined) return
        editDoc((current) => ({
          version: 1,
          prompts: current.prompts.filter((candidate) => candidate.id !== target.id),
        }))
        if (draft !== null && draft.id === target.id) setDraft(null)
        flash(t('removed'), 'ok')
      }

      const editor = draft === null
        ? null
        : h(PromptEditor, {
          key: draft.id === null ? 'new' : draft.id,
          draft,
          t,
          onChange: (next) => setDraft(next),
          onSave: save,
          onCancel: () => setDraft(null),
        })

      const items = []
      if (editor !== null) items.push(editor)
      if (confirmId !== null) {
        items.push(h(
          'div',
          { className: 'dshpl-confirm', key: 'confirm' },
          h('span', {}, t('confirmDelete')),
          h(
            'span',
            { className: 'dshpl-confirm-actions' },
            h('button', { type: 'button', className: 'dshpl-button', onClick: () => setConfirmId(null) }, t('cancel')),
            h('button', { type: 'button', className: 'dshpl-button', 'data-danger': 'true', onClick: confirmRemove }, t('deleteAction')),
          ),
        ))
      }
      if (visible.length === 0) {
        items.push(h('p', { className: 'dshpl-empty', key: 'empty' }, needle === '' ? t('empty') : t('emptySearch')))
      }
      for (const prompt of visible) {
        items.push(h(PromptCard, {
          key: prompt.id,
          prompt,
          t,
          onInsert: insert,
          onEdit: startEdit,
          onCopy: copy,
          onRemove: remove,
        }))
      }

      return h(
        'div',
        { className: 'dshpl-root' },
        h('style', { key: 'style' }, STYLE_TEXT),
        h(
          'div',
          { className: 'dshpl-head', key: 'head' },
          h('input', {
            className: 'dshpl-search',
            type: 'search',
            value: query,
            placeholder: t('search'),
            'aria-label': t('search'),
            onChange: (event) => setQuery(event.target.value),
          }),
          h(
            'button',
            { type: 'button', className: 'dshpl-new', onClick: startCreate },
            h('span', { 'aria-hidden': true }, '+'),
            h('span', {}, t('create')),
          ),
        ),
        h('div', { className: 'dshpl-list', key: 'list' }, items),
        notice === null
          ? null
          : h('div', { className: 'dshpl-notice', key: 'notice', role: 'status', 'data-tone': notice.tone }, notice.text),
        h(
          'div',
          { className: 'dshpl-foot', key: 'foot' },
          h('span', {}, t('hint')),
          h('span', {}, t('countPrefix') + prompts.length + t('countSuffix')),
        ),
      )
    }

    //#endregion

    //#region registration

    /** Cordis plugin body for the browser half. */
    const plugin = {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)

        // A hot reload of this module can meet a namespace that a previous generation still
        // owns; report it instead of failing the whole plugin activation.
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, dictionaries)
          } catch (error) {
            console.error('[dsh-prompt-library] locale registration was refused', error)
            return () => {}
          }
        }, 'dsh-prompt-library: dictionaries')

        ctx.effect(() => {
          try {
            return ctx.sidebarRightTabs.register({
              id: ID,
              kind: KIND,
              title: () => t('tabTitle'),
              guide: [
                {
                  id: 'prompts',
                  order: GUIDE_ORDER,
                  title: () => t('tabTitle'),
                  description: () => t('guideDescription'),
                  icon: LibraryGlyph,
                },
              ],
            })
          } catch (error) {
            console.error('[dsh-prompt-library] the right-Sidebar tab type could not be registered', error)
            return () => {}
          }
        }, 'dsh-prompt-library: tab type')

        ctx.effect(
          () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: ID,
          }, (props) => h(PromptLibraryBody, { ...props, t }))),
          'dsh-prompt-library: tab body',
        )

        // The New Session row (the one carrying the workspace and preset controls) is the only
        // place a blank conversation offers a composer trigger, so the compact button lives there.
        ctx.effect(
          () => ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
            name: 'conversation.hero.options',
            id: MENU_ID,
          }, (props) => h(HeroPromptButton, { ...props, t }))),
          'dsh-prompt-library: New Session trigger',
        )

        // The menu is anchored to that trigger but drawn in the frame-wide layer, which sits above
        // every column and outside their clipping containers.
        ctx.effect(
          () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: MENU_ID,
          }, () => h(PromptMenuOverlay, { t }))),
          'dsh-prompt-library: prompt menu overlay',
        )
      },
    }

    return plugin
  },
})
