/**
 * Prompt library — a right-Sidebar tab, a shortcut on the New Session row, and a Settings section.
 *
 * Five public extension points are used:
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
 * 5. `ctx.slots.register({ name: 'settings.section', id })` puts the same library in Settings,
 *    with a matching `settings.section.icon` row, so prompts can be maintained with the right
 *    Sidebar closed.
 *
 * The prompts themselves live in this browser's localStorage under one key, shared by every open
 * occurrence of the tab and by the menu, so an edit anywhere is visible everywhere.
 *
 * Picking a prompt into a composer remembers the range it occupies and that composer's content
 * revision. Picking another prompt while the revision is unchanged swaps the remembered range in
 * place, so switching prompts replaces the previous prompt instead of appending to it. Any edit to
 * the draft moves the revision, which turns the next pick back into an ordinary caret insertion.
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
    /** Settings navigation id: the section and its icon share it. */
    const SETTINGS_ID = 'prompt-library'
    /** Place of the section among the shipped settings sections. */
    const SETTINGS_ORDER = 42
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
      hint: '点击插入，长按拖动排序；输入框未修改时再点会替换。右侧按钮可编辑或删除。',
      hintSettings: '点击编辑，长按拖动排序；右侧按钮可复制或删除。',
      settingsIntro: '这里维护「提示词」按钮里的内容。右侧栏的「常用提示词」面板用的是同一份列表，改一边两边都会更新。',
      inserted: '已插入到输入框',
      replaced: '已替换提示词',
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
      tagsLabel: '标签',
      tagPlaceholder: '添加标签…',
      removeTag: '移除标签',
      tagsHint: '回车或逗号添加标签，最多 8 个',
      tagsFull: '最多 8 个标签',
      filterAll: '全部',
      filterByTag: '按标签筛选',
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
      hint: 'Pick to insert; press and hold to reorder. Picking another replaces it while the draft is unchanged. The buttons on the right edit or delete it.',
      hintSettings: 'Pick to edit; press and hold to reorder. The buttons on the right copy or delete it.',
      settingsIntro: 'These are the prompts behind the prompt button. The right Sidebar\'s Prompt library tab shows the same list, so an edit in either place updates both.',
      inserted: 'Inserted into the composer',
      replaced: 'Replaced the prompt',
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
      tagsLabel: 'Tags',
      tagPlaceholder: 'Add a tag…',
      removeTag: 'Remove tag',
      tagsHint: 'Press Enter or comma to add a tag; up to 8',
      tagsFull: 'Up to 8 tags',
      filterAll: 'All',
      filterByTag: 'Filter by tag',
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
        tags: ['代码'],
      },
      {
        title: '补充单元测试',
        content: '为下面的代码补充单元测试，覆盖正常路径与边界情况，并保持与项目现有测试风格一致：\n\n',
        tags: ['代码', '测试'],
      },
      {
        title: '解释代码',
        content: '请逐步解释下面这段代码的作用、关键流程和潜在的坑：\n\n',
        tags: ['代码', '学习'],
      },
      {
        title: '精简重写',
        content: '请在不改变含义的前提下精简并重写下面这段文字，保持专业、准确、简洁：\n\n',
        tags: ['写作'],
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

    /** Most tags one prompt may carry. */
    const MAX_TAGS = 8
    /** Longest tag the editor accepts, in characters. */
    const MAX_TAG_LENGTH = 24

    /**
     * Normalize one tag for storage and comparison: drop a leading hash, collapse whitespace,
     * clip overlong text, and return '' for anything that carries no text.
     * @param {unknown} value - Raw tag text.
     * @returns {string} The usable tag, or ''.
     */
    function normalizeTag(value) {
      if (typeof value !== 'string') return ''
      const tag = value.replace(/^#+/u, '').replace(/\s+/gu, ' ').trim()
      if (tag === '') return ''
      return tag.length > MAX_TAG_LENGTH ? tag.slice(0, MAX_TAG_LENGTH) : tag
    }

    /**
     * Normalize a stored or editable tag list: drop empties and duplicates (case-insensitive),
     * keep the first spelling and order, and stop at the per-prompt cap.
     * @param {unknown} value - Raw tag list.
     * @returns {string[]} Distinct tags.
     */
    function normalizeTags(value) {
      if (!Array.isArray(value)) return []
      const tags = []
      const seen = new Set()
      for (const item of value) {
        const tag = normalizeTag(item)
        if (tag === '') continue
        const key = tag.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        tags.push(tag)
        if (tags.length === MAX_TAGS) break
      }
      return tags
    }

    /**
     * @param {string[]} tags - Current tags.
     * @param {string} tag - Normalized tag to append.
     * @returns {string[] | null} The next list, or null when the tag is empty, duplicate, or the cap is reached.
     */
    function appendTag(tags, tag) {
      if (tag === '' || tags.length >= MAX_TAGS) return null
      if (tags.some((item) => item.toLowerCase() === tag.toLowerCase())) return null
      return [...tags, tag]
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
          tags: normalizeTags(item.tags),
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
          tags: normalizeTags(entry.tags),
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

    //#region card order

    /** Hold this long on a card body before the card becomes draggable. */
    const REORDER_HOLD_MS = 420
    /** Pointer travel that abandons the hold instead of starting a drag. */
    const REORDER_SLOP_PX = 8
    /** Height of the strip at either end of the list that scrolls while dragging. */
    const REORDER_SCROLL_EDGE_PX = 30

    /**
     * Long-press reordering for the cards of one list.
     *
     * The pressed card is cloned into a fixed-position layer so the drag is not clipped by the
     * list's scroll box, while a dashed gap inside the list marks where it would land. Only the
     * cards currently visible take part; the commit callback decides how their new order maps
     * back into the full document.
     *
     * @param {{ current: HTMLElement | null }} listRef - Ref to the list element.
     * @param {string[]} orderIds - Visible prompt ids, top to bottom.
     * @param {(ids: string[], from: number, to: number) => void} commit - Applies one reorder.
     * @param {{ current: boolean }} suppressClickRef - Set when the release must not activate the card.
     * @returns {(event: object) => void} Pointer-down handler for the list.
     */
    function useCardReorder(listRef, orderIds, commit, suppressClickRef) {
      const latest = React.useRef({ orderIds, commit })
      latest.current = { orderIds, commit }
      const pressRef = React.useRef(null)

      React.useEffect(() => () => {
        const press = pressRef.current
        if (press !== null && typeof press.dispose === 'function') press.dispose()
      }, [])

      return React.useCallback((event) => {
        if (pressRef.current !== null) return
        const target = event.target
        if (!(target instanceof Element)) return
        const main = target.closest('.dshpl-card-main')
        if (main === null) return
        const card = main.closest('.dshpl-card')
        const list = listRef.current
        if (card === null || list === null || !list.contains(card)) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (event.isPrimary === false) return
        const id = card.dataset.promptId
        if (typeof id !== 'string' || id === '') return
        const cards = [...list.querySelectorAll('.dshpl-card')]
        const from = cards.indexOf(card)
        if (from === -1) return
        const order = latest.current.orderIds.slice()
        if (order[from] !== id) return

        const press = {
          id,
          card,
          list,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          timer: 0,
          active: false,
          clone: null,
          gap: null,
          targets: [],
          height: 0,
          grabOffset: 0,
          lastCenter: 0,
          dropBefore: null,
          sourceDisplay: null,
          order,
          dispose: null,
        }
        pressRef.current = press

        const onMove = (next) => {
          if (pressRef.current !== press || next.pointerId !== press.pointerId) return
          if (!press.active) {
            if (Math.hypot(next.clientX - press.startX, next.clientY - press.startY) > REORDER_SLOP_PX) {
              end(false)
            }
            return
          }
          next.preventDefault()
          press.lastX = next.clientX
          press.lastY = next.clientY
          if (press.clone !== null) {
            press.clone.style.transform = 'translate3d(' + (next.clientX - press.startX) + 'px,'
              + (next.clientY - press.startY) + 'px,0)'
          }
          setMarks(next.clientX, next.clientY, true)
        }

        const onTouchMove = (next) => {
          if (press.active) next.preventDefault()
        }

        const onUp = (next) => {
          if (pressRef.current !== press || next.pointerId !== press.pointerId) return
          if (!press.active) {
            end(false)
            return
          }
          const before = press.dropBefore
          const index = press.order.indexOf(press.id)
          const target = before === null ? index : before
          end(true)
          if (target !== index && index !== -1 && target >= 0 && target < press.order.length) {
            latest.current.commit(press.order, index, target)
          }
        }

        const onCancel = (next) => {
          if (next !== undefined && next.pointerId !== undefined && next.pointerId !== press.pointerId) return
          end(press.active)
        }

        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          end(true)
        }

        const onContext = (event) => {
          event.preventDefault()
        }

        const onScroll = () => {
          if (press.active) setMarks(press.lastX, press.lastY, false)
        }

        const onBlur = () => {
          onCancel()
        }

        const clearMarks = () => {
          card.removeAttribute('data-dragging')
        }

        const placeGap = () => {
          if (press.gap === null) return
          if (press.dropBefore < press.targets.length) list.insertBefore(press.gap, press.targets[press.dropBefore])
          else list.appendChild(press.gap)
        }

        const setMarks = (x, y, allowScroll) => {
          press.lastX = x
          press.lastY = y
          if (press.gap === null) return
          const bounds = list.getBoundingClientRect()
          // Compare the lifted card's center (not the pointer) with the remaining cards, so a
          // drag of one card height always swaps one place no matter where it was grabbed.
          const center = y - press.grabOffset + press.height / 2 - bounds.top + list.scrollTop
          const delta = center - press.lastCenter
          if (delta !== 0) {
            const centers = press.targets.map((item) => {
              const itemRect = item.getBoundingClientRect()
              return itemRect.top + itemRect.height / 2 - bounds.top + list.scrollTop
            })
            if (delta > 0) {
              while (press.dropBefore < centers.length && center >= centers[press.dropBefore]) {
                press.dropBefore += 1
              }
            } else {
              while (press.dropBefore > 0 && center <= centers[press.dropBefore - 1]) {
                press.dropBefore -= 1
              }
            }
          }
          press.lastCenter = center
          placeGap()
          if (allowScroll) {
            if (y < bounds.top + REORDER_SCROLL_EDGE_PX) list.scrollTop -= 10
            else if (y > bounds.bottom - REORDER_SCROLL_EDGE_PX) list.scrollTop += 10
          }
        }

        const end = (suppress) => {
          if (pressRef.current !== press) return
          pressRef.current = null
          window.clearTimeout(press.timer)
          window.removeEventListener('pointermove', onMove, { capture: true })
          window.removeEventListener('pointerup', onUp, { capture: true })
          window.removeEventListener('pointercancel', onCancel, { capture: true })
          window.removeEventListener('keydown', onKey, { capture: true })
          window.removeEventListener('contextmenu', onContext, { capture: true })
          window.removeEventListener('touchmove', onTouchMove, { capture: true })
          window.removeEventListener('blur', onBlur)
          list.removeEventListener('scroll', onScroll)
          if (press.clone !== null) press.clone.remove()
          if (press.gap !== null) press.gap.remove()
          if (press.active) card.style.display = press.sourceDisplay ?? ''
          clearMarks()
          document.documentElement.classList.remove('dshpl-reordering')
          try {
            if (card.hasPointerCapture(press.pointerId)) card.releasePointerCapture(press.pointerId)
          } catch {
            // A synthetic pointer, or one the browser already released, has no capture to drop.
          }
          if (suppress) {
            suppressClickRef.current = true
            window.setTimeout(() => {
              suppressClickRef.current = false
            }, 600)
          }
        }

        const activate = () => {
          if (pressRef.current !== press || !card.isConnected) {
            end(false)
            return
          }
          press.timer = 0
          press.active = true
          const rect = card.getBoundingClientRect()
          const clone = card.cloneNode(true)
          clone.classList.add('dshpl-drag-clone')
          clone.removeAttribute('data-dragging')
          clone.removeAttribute('data-prompt-id')
          clone.setAttribute('inert', '')
          clone.setAttribute('aria-hidden', 'true')
          for (const button of clone.querySelectorAll('button')) button.tabIndex = -1
          clone.style.width = rect.width + 'px'
          clone.style.height = rect.height + 'px'
          clone.style.left = rect.left + 'px'
          clone.style.top = rect.top + 'px'
          document.body.appendChild(clone)
          press.clone = clone
          press.height = rect.height
          press.grabOffset = press.startY - rect.top
          // The lifted card leaves the flow; the dashed gap below is its only placeholder, so
          // every position is measured against the cards that stay.
          press.targets = [...list.querySelectorAll('.dshpl-card')].filter((item) => item !== card)
          try {
            card.setPointerCapture(press.pointerId)
          } catch {
            // Synthetic pointers cannot be captured; the window listeners still receive the move.
          }
          press.sourceDisplay = card.style.display
          card.style.display = 'none'
          card.setAttribute('data-dragging', 'true')
          const gap = document.createElement('div')
          gap.className = 'dshpl-drop-gap'
          gap.style.height = rect.height + 'px'
          if (card.nextElementSibling === null) list.appendChild(gap)
          else list.insertBefore(gap, card.nextElementSibling)
          press.gap = gap
          const bounds = list.getBoundingClientRect()
          press.dropBefore = Math.max(0, Math.min(press.order.indexOf(id), press.targets.length))
          press.lastCenter = press.startY - press.grabOffset + press.height / 2 - bounds.top + list.scrollTop
          placeGap()
          document.documentElement.classList.add('dshpl-reordering')
          list.addEventListener('scroll', onScroll, { passive: true })
          try {
            if (typeof navigator.vibrate === 'function') navigator.vibrate(8)
          } catch {
            // Vibration is an optional nicety and may be blocked.
          }
          setMarks(press.lastX, press.lastY, false)
        }

        press.dispose = () => end(false)

        window.addEventListener('pointermove', onMove, { capture: true, passive: false })
        window.addEventListener('pointerup', onUp, { capture: true })
        window.addEventListener('pointercancel', onCancel, { capture: true })
        window.addEventListener('keydown', onKey, { capture: true })
        window.addEventListener('contextmenu', onContext, { capture: true })
        window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
        window.addEventListener('blur', onBlur)
        press.timer = window.setTimeout(activate, REORDER_HOLD_MS)
      }, [listRef, suppressClickRef])
    }

    //#endregion

    //#region composer bridge

    /** Reference placeholders the composer strips from every externally supplied text. */
    const PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu

    /**
     * The range the last prompt this plugin wrote into a composer occupies, keyed by the session's
     * stable InputActions face. The revision is the composer's content revision, which only moves
     * when the draft's text or chips change (moving the caret does not), so an equal revision means
     * the prompt is still exactly where it was left.
     * @type {WeakMap<object, { start: number, end: number, draftRev: number }>}
     */
    const writtenPrompts = new WeakMap()

    /**
     * Mirror the composer's own normalization so remembered offsets and text length stay in its
     * detect coordinates: CRLF becomes LF and literal placeholder characters are dropped.
     * @param {string} text - Prompt text.
     * @returns {string} Text the composer will actually insert.
     */
    function normalizePromptText(text) {
      return String(text).replace(/\r\n?/gu, '\n').replace(PLACEHOLDER_RE, '')
    }

    /**
     * Read the composer's current selection and revision through the public InputActions face.
     * @param {object | undefined} inputActions - Session standard prop.
     * @returns {{ start: number, end: number, draftRev: number } | null} The current span.
     */
    function captureInsertionSpan(inputActions) {
      try {
        const span = inputActions.captureInsertion()
        if (span === undefined || span === null) return null
        const { start, end, draftRev } = span
        if (typeof start !== 'number' || typeof end !== 'number' || typeof draftRev !== 'number') return null
        return { start, end, draftRev }
      } catch {
        return null
      }
    }

    /**
     * Remember the range the text just inserted at `start` now occupies. The end offset follows
     * from the text length because plain prompt text maps one detect offset per character.
     * @param {object} inputActions - Session standard prop.
     * @param {number} start - Offset the insertion began at.
     * @param {string} text - Sanitized text that was inserted.
     */
    function rememberInsertion(inputActions, start, text) {
      const after = captureInsertionSpan(inputActions)
      if (after === null) {
        writtenPrompts.delete(inputActions)
        return
      }
      writtenPrompts.set(inputActions, { start, end: start + text.length, draftRev: after.draftRev })
    }

    /**
     * Write one prompt into the composer.
     *
     * When the draft has not changed since the previous prompt this plugin inserted, the previous
     * prompt's range is replaced in place, so picking another prompt swaps it instead of appending.
     * Once the draft has been edited the remembered revision no longer matches and the prompt is
     * inserted at the caret, exactly like any other insertion.
     * @param {object | undefined} inputActions - Session standard prop.
     * @param {string} content - Prompt text.
     * @returns {'inserted' | 'replaced' | null} How the text arrived, or null when the composer refused it.
     */
    function writePrompt(inputActions, content) {
      if (inputActions === undefined || inputActions === null) return null
      if (typeof inputActions.captureInsertion !== 'function') return null
      if (typeof inputActions.insertText !== 'function') return null
      const text = normalizePromptText(content)
      if (text === '') return null
      const current = captureInsertionSpan(inputActions)
      if (current === null) return null

      const previous = writtenPrompts.get(inputActions)
      if (previous !== undefined && previous.draftRev === current.draftRev) {
        try {
          const swap = { start: previous.start, end: previous.end, draftRev: current.draftRev }
          if (inputActions.insertText(text, swap) === true) {
            rememberInsertion(inputActions, swap.start, text)
            return 'replaced'
          }
        } catch {
          // Fall through to an ordinary insertion at the caret.
        }
      }

      // Re-read the caret so an edit that landed after the first capture still inserts at the
      // position the composer holds now.
      const caret = captureInsertionSpan(inputActions)
      if (caret === null) return null
      try {
        const span = { start: caret.start, end: caret.end, draftRev: caret.draftRev }
        if (inputActions.insertText(text, span) !== true) return null
      } catch {
        return null
      }
      rememberInsertion(inputActions, caret.start, text)
      return 'inserted'
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
    const MENU_WIDTH = 264
    /** Tallest the menu grows before its list scrolls. */
    const MENU_MAX_HEIGHT = 336
    /** Distance between the trigger and the menu. */
    const MENU_GAP = 4
    /** Space the menu keeps from every viewport edge. */
    const MENU_INSET = 8
    /** Room below the trigger needed to open downwards instead of upwards. */
    const MENU_MIN_BELOW = 168

    /**
     * The prompt menu opens from a compact control in the New Session row and is drawn by the
     * frame-wide overlay, which is a different render subtree with no composer props. This
     * module-level store carries the trigger geometry and the insertion target across that
     * boundary, the same way the library document is shared with the sidebar tab.
     * @type {null | { anchorEl: Element, rect: { top: number, bottom: number, right: number }, insert: (content: string) => 'inserted' | 'replaced' | null }}
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
          insert: (content) => writePrompt(inputActions, content),
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
        h('span', { className: 'dshpl-hero-label' }, t('heroButton')),
        h(ChevronGlyph, { size: 14 }),
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
        if (state.insert(prompt.content) !== null) {
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
        : doc.prompts.map((prompt, index) => {
          const tags = Array.isArray(prompt.tags) ? prompt.tags : []
          return h(
            'button',
            {
              key: prompt.id,
              ref: index === 0 ? firstRef : undefined,
              type: 'button',
              role: 'menuitem',
              className: 'dshpl-menu-item',
              onClick: () => pick(prompt),
            },
            h(
              'span',
              { className: 'dshpl-menu-main' },
              h('span', { className: 'dshpl-menu-title' }, prompt.title),
              tags.length === 0
                ? null
                : h(
                  'span',
                  { className: 'dshpl-menu-tags' },
                  tags.slice(0, 3).join(' · ') + (tags.length > 3 ? ' …' : ''),
                ),
            ),
          )
        })

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
     * Navigation glyph of the Settings section; the shell supplies the square edge.
     * @param {{ size?: number }} props - Requested square edge.
     */
    function SettingsGlyph({ size = 20 }) {
      return h(LibraryGlyph, { size })
    }

    /**
     * The disclosure chevron the New Session trigger carries, matching the host's control row.
     * @param {{ size?: number, className?: string }} props - Glyph sizing.
     */
    function ChevronGlyph({ size = 14, className }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className,
          'aria-hidden': true,
        },
        h('path', { d: 'M7 10l5 5 5-5' }),
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
.dshpl-tags {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 0 12px 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.dshpl-tags::-webkit-scrollbar { display: none; }
.dshpl-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 170px;
  height: 18px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm, 4px);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 10.5px;
  line-height: 16px;
  white-space: nowrap;
}
.dshpl-tag-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpl-tag-count { flex: none; opacity: 0.65; font-size: 10px; }
.dshpl-tag-filter {
  flex: none;
  height: 20px;
  cursor: pointer;
  border-color: var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dshpl-tag-filter:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshpl-tag-filter[data-active="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.dshpl-tag-filter:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
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
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1);
}
.dshpl-card:hover { border-color: var(--dsw-alias-border-l2); }
.dshpl-card[data-dragging="true"] { opacity: .35; }
.dshpl-drop-gap {
  flex: none;
  box-sizing: border-box;
  border: 1px dashed color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);
  border-radius: var(--dsw-radius-sm, 8px);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent);
}
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
  -webkit-touch-callout: none;
}
.dshpl-card-main:hover { background: var(--dsw-alias-bg-layer-2); }
.dshpl-card-main:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dshpl-card-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpl-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dshpl-card-tags .dshpl-tag {
  height: 17px;
  font-size: 10px;
  line-height: 15px;
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
.dshpl-drag-clone {
  position: fixed;
  z-index: 1300;
  box-sizing: border-box;
  margin: 0;
  pointer-events: none;
  cursor: grabbing;
  opacity: .98;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 14px 34px rgb(0 0 0 / 20%), 0 2px 8px rgb(0 0 0 / 12%);
  will-change: transform;
}
html.dshpl-reordering,
html.dshpl-reordering * { cursor: grabbing !important; }
html.dshpl-reordering { user-select: none; }
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
.dshpl-editor-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  box-sizing: border-box;
  padding: 4px 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-base);
}
.dshpl-editor-tags:focus-within { border-color: var(--dsw-alias-brand-primary); }
.dshpl-editor-tag { height: 20px; font-size: 11px; line-height: 18px; }
.dshpl-tag-remove {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-right: -2px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.dshpl-tag-remove:hover {
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}
.dshpl-tag-remove:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshpl-tag-input {
  flex: 1;
  min-width: 90px;
  height: 24px;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  outline: none;
}
.dshpl-tag-input::placeholder { color: var(--dsw-alias-label-secondary); }
.dshpl-tag-input:disabled { cursor: default; }
.dshpl-editor-hint {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}
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
.dshpl-foot-hint { min-width: 0; }
.dshpl-foot-count {
  flex: none;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
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
  min-height: 28px;
  max-width: 220px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
.dshpl-hero:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.dshpl-hero[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.dshpl-hero:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}
.dshpl-hero-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpl-hero-chevron {
  flex: none;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-secondary));
}
.dshpl-menu {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px;
  border: 0;
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-overlay));
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent, 0 12px 30px rgb(0 0 0 / 16%));
  color: var(--dsw-alias-label-primary);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dshpl-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  min-height: 34px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.dshpl-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.dshpl-menu-item:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  outline: none;
}
.dshpl-menu-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dshpl-menu-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpl-menu-tags {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  font-size: 11px;
  line-height: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpl-menu-empty {
  padding: 6px 8px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  font-size: 12px;
  line-height: 18px;
}
.dshpl-menu-error {
  margin-top: 3px;
  padding: 5px 8px;
  border-top: .5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.dshpl-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
}
.dshpl-settings-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dshpl-settings-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dshpl-settings-intro {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.dshpl-root-settings {
  flex: none;
  height: auto;
  min-height: 0;
}
.dshpl-root-settings .dshpl-head { padding: 0 0 4px; }
.dshpl-root-settings .dshpl-tags { padding: 0 0 8px; }
.dshpl-root-settings .dshpl-list {
  flex: none;
  overflow: visible;
  padding: 0;
}
.dshpl-root-settings .dshpl-foot { padding: 8px 0 0; }
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

    /** Marks the one stylesheet this plugin owns, so a reload replaces it instead of stacking copies. */
    const STYLE_TAG_ID = '@local/dsh-prompt-library/panel.css'

    /**
     * Add the plugin's stylesheet to the page.
     *
     * It must live outside the components: the tab body, the New Session trigger and the overlay
     * menu are three separate render subtrees, and the trigger and the menu are visible while the
     * Sidebar tab is closed. Install it once from `apply` instead of rendering it in the tab.
     * @returns {() => void} Remove the stylesheet.
     */
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      for (const stale of document.querySelectorAll('style[data-plugin-css=' + JSON.stringify(STYLE_TAG_ID) + ']')) {
        stale.remove()
      }
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-prompt-library'
      tag.dataset.pluginCss = STYLE_TAG_ID
      tag.textContent = STYLE_TEXT
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    //#endregion

    //#region components

    /**
     * One prompt's read mode.
     * @param {{ prompt: object, t: Function, onInsert: Function, onEdit: Function, onCopy: Function, onRemove: Function }} props
     */
    function PromptCard({ prompt, t, onInsert, onEdit, onCopy, onRemove }) {
      const preview = prompt.content.trim()
      const tags = Array.isArray(prompt.tags) ? prompt.tags : []
      const shownTags = tags.slice(0, 3)
      const hiddenTags = tags.length - shownTags.length
      return h(
        'div',
        { className: 'dshpl-card', 'data-prompt-id': prompt.id },
        h(
          'button',
          {
            type: 'button',
            className: 'dshpl-card-main',
            title: preview.length > 400 ? preview.slice(0, 400) + '…' : preview,
            onClick: () => onInsert(prompt),
          },
          h('span', { className: 'dshpl-card-title' }, prompt.title),
          tags.length === 0
            ? null
            : h(
              'span',
              { className: 'dshpl-card-tags' },
              shownTags.map((tag) => h(
                'span',
                { className: 'dshpl-tag', key: tag, title: tag },
                h('span', { className: 'dshpl-tag-label' }, tag),
              )),
              hiddenTags > 0
                ? h('span', { className: 'dshpl-tag dshpl-tag-more', title: tags.join(' · ') }, '+' + hiddenTags)
                : null,
            ),
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
      const doc = useDoc()
      const titleRef = React.useRef(null)
      const [pendingTag, setPendingTag] = React.useState('')
      const suggestionsId = React.useMemo(() => 'dshpl-tag-suggestions-' + makeId(), [])
      const tags = Array.isArray(draft.tags) ? draft.tags : []

      React.useEffect(() => {
        if (titleRef.current !== null) titleRef.current.focus()
      }, [])

      // Every tag already used elsewhere, minus the ones this prompt carries. The datalist is
      // only a suggestion: typing a new tag always works.
      const suggestions = React.useMemo(() => {
        const seen = new Set(tags.map((tag) => tag.toLowerCase()))
        const list = []
        for (const prompt of doc.prompts) {
          for (const tag of prompt.tags ?? []) {
            const key = tag.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            list.push(tag)
            if (list.length === 40) return list
          }
        }
        return list
      }, [doc, tags])

      const save = () => {
        const tag = normalizeTag(pendingTag)
        const nextTags = tag === '' ? null : appendTag(tags, tag)
        onSave(nextTags === null ? { ...draft, tags } : { ...draft, tags: nextTags })
      }

      const commitTag = () => {
        const tag = normalizeTag(pendingTag)
        if (tag !== '') {
          const next = appendTag(tags, tag)
          if (next !== null) onChange({ ...draft, tags: next })
        }
        setPendingTag('')
      }

      const removeTag = (tag) => {
        onChange({ ...draft, tags: tags.filter((item) => item !== tag) })
      }

      const onTagKeyDown = (event) => {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
          event.preventDefault()
          if (event.metaKey || event.ctrlKey) save()
          else commitTag()
          return
        }
        if (event.key === ',' || event.key === '，') {
          event.preventDefault()
          commitTag()
          return
        }
        if (event.key === 'Backspace' && pendingTag === '' && tags.length > 0) {
          event.preventDefault()
          removeTag(tags[tags.length - 1])
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }

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
        h('span', { className: 'dshpl-editor-label' }, t('tagsLabel')),
        h(
          'div',
          { className: 'dshpl-editor-tags' },
          tags.map((tag) => h(
            'span',
            { className: 'dshpl-tag dshpl-editor-tag', key: tag },
            h('span', { className: 'dshpl-tag-label' }, tag),
            h(
              'button',
              {
                type: 'button',
                className: 'dshpl-tag-remove',
                title: t('removeTag'),
                'aria-label': t('removeTag') + ': ' + tag,
                onClick: () => removeTag(tag),
              },
              '\u00d7',
            ),
          )),
          h('input', {
            className: 'dshpl-tag-input',
            type: 'text',
            value: pendingTag,
            placeholder: tags.length >= MAX_TAGS ? t('tagsFull') : t('tagPlaceholder'),
            maxLength: MAX_TAG_LENGTH,
            list: suggestions.length === 0 ? undefined : suggestionsId,
            disabled: tags.length >= MAX_TAGS,
            'aria-label': t('tagPlaceholder'),
            onChange: (event) => setPendingTag(event.target.value),
            onKeyDown: onTagKeyDown,
          }),
          suggestions.length === 0
            ? null
            : h('datalist', { id: suggestionsId }, suggestions.map((tag) => h('option', { key: tag, value: tag }))),
        ),
        h('span', { className: 'dshpl-editor-hint' }, t('tagsHint')),
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
    function PromptLibraryBody({ t, inputActions, variant = 'tab' }) {
      const settings = variant === 'settings'
      const doc = useDoc()
      const [query, setQuery] = React.useState('')
      const [tagFilter, setTagFilter] = React.useState(null)
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

      // Tag facets: one entry per tag spelling, counted once per prompt, most-used first.
      const tagIndex = new Map()
      for (const prompt of prompts) {
        for (const tag of prompt.tags ?? []) {
          const key = tag.toLowerCase()
          const entry = tagIndex.get(key)
          if (entry === undefined) tagIndex.set(key, { key, tag, count: 1 })
          else entry.count += 1
        }
      }
      const tags = [...tagIndex.values()].sort((left, right) =>
        right.count - left.count || left.tag.localeCompare(right.tag))
      const activeTag = tagFilter !== null && tagIndex.has(tagFilter) ? tagFilter : null

      const visible = prompts.filter((prompt) => {
        if (activeTag !== null && !(prompt.tags ?? []).some((tag) => tag.toLowerCase() === activeTag)) return false
        if (needle === '') return true
        if (prompt.title.toLowerCase().includes(needle)) return true
        if (prompt.content.toLowerCase().includes(needle)) return true
        return (prompt.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
      })
      const filtering = needle !== '' || activeTag !== null
      const orderIds = visible.map((prompt) => prompt.id)
      const listRef = React.useRef(null)
      const suppressClickRef = React.useRef(false)

      /**
       * Put the visible cards into their dropped order, keeping the slots that hidden prompts
       * occupy in the full document so a filtered list never scatters the rest of the library.
       */
      const reorder = React.useCallback((ids, from, to) => {
        editDoc((current) => {
          const moving = ids.slice()
          const [moved] = moving.splice(from, 1)
          if (moved === undefined) return current
          moving.splice(to, 0, moved)
          const visibleIds = new Set(ids)
          const slots = []
          current.prompts.forEach((prompt, index) => {
            if (visibleIds.has(prompt.id)) slots.push(index)
          })
          if (slots.length !== moving.length) return current
          const byId = new Map(current.prompts.map((prompt) => [prompt.id, prompt]))
          const prompts = current.prompts.slice()
          slots.forEach((slot, index) => {
            const prompt = byId.get(moving[index])
            if (prompt !== undefined) prompts[slot] = prompt
          })
          return { ...current, prompts }
        })
      }, [])

      const onCardPointerDown = useCardReorder(listRef, orderIds, reorder, suppressClickRef)

      const insert = (prompt) => {
        setConfirmId(null)
        const outcome = writePrompt(inputActions, prompt.content)
        if (outcome !== null) {
          flash(t(outcome === 'replaced' ? 'replaced' : 'inserted'), 'ok')
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
        // A fresh prompt is inserted at the top; clear the filters so it cannot land out of view.
        setQuery('')
        setTagFilter(null)
        setDraft({ id: null, title: '', content: '', tags: [] })
      }

      const startEdit = (prompt) => {
        setConfirmId(null)
        setDraft({
          id: prompt.id,
          title: prompt.title,
          content: prompt.content,
          tags: Array.isArray(prompt.tags) ? [...prompt.tags] : [],
        })
      }

      const save = (candidate) => {
        const content = candidate.content.trim()
        if (content === '') {
          flash(t('contentRequired'), 'error')
          return
        }
        const title = candidate.title.trim() === '' ? titleFromContent(content) || t('newPromptTitle') : candidate.title.trim()
        const tags = normalizeTags(candidate.tags)
        const now = Date.now()
        if (candidate.id === null) {
          editDoc((current) => ({
            version: 1,
            prompts: [{ id: makeId(), title, content, tags, createdAt: now, updatedAt: now }, ...current.prompts],
          }))
        } else {
          editDoc((current) => ({
            version: 1,
            prompts: current.prompts.map((prompt) =>
              prompt.id === candidate.id ? { ...prompt, title, content, tags, updatedAt: now } : prompt),
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
        items.push(h('p', { className: 'dshpl-empty', key: 'empty' }, filtering ? t('emptySearch') : t('empty')))
      }
      for (const prompt of visible) {
        items.push(h(PromptCard, {
          key: prompt.id,
          prompt,
          t,
          onInsert: settings ? startEdit : insert,
          onEdit: startEdit,
          onCopy: copy,
          onRemove: remove,
        }))
      }

      return h(
        'div',
        { className: settings ? 'dshpl-root dshpl-root-settings' : 'dshpl-root' },
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
        tags.length === 0
          ? null
          : h(
            'div',
            { className: 'dshpl-tags', key: 'tags', role: 'group', 'aria-label': t('filterByTag') },
            h(
              'button',
              {
                type: 'button',
                className: 'dshpl-tag dshpl-tag-filter',
                'data-active': activeTag === null ? 'true' : 'false',
                'aria-pressed': activeTag === null ? 'true' : 'false',
                onClick: () => setTagFilter(null),
              },
              h('span', { className: 'dshpl-tag-label' }, t('filterAll')),
            ),
            tags.map(({ key, tag, count }) => h(
              'button',
              {
                key,
                type: 'button',
                className: 'dshpl-tag dshpl-tag-filter',
                title: tag,
                'data-active': activeTag === key ? 'true' : 'false',
                'aria-pressed': activeTag === key ? 'true' : 'false',
                onClick: () => setTagFilter(activeTag === key ? null : key),
              },
              h('span', { className: 'dshpl-tag-label' }, tag),
              h('span', { className: 'dshpl-tag-count' }, String(count)),
            )),
          ),
        h(
          'div',
          {
            className: 'dshpl-list',
            key: 'list',
            ref: listRef,
            onPointerDown: onCardPointerDown,
            onClickCapture: (event) => {
              if (!suppressClickRef.current) return
              suppressClickRef.current = false
              event.preventDefault()
              event.stopPropagation()
            },
          },
          items,
        ),
        notice === null
          ? null
          : h('div', { className: 'dshpl-notice', key: 'notice', role: 'status', 'data-tone': notice.tone }, notice.text),
        h(
          'div',
          { className: 'dshpl-foot', key: 'foot' },
          h('span', { className: 'dshpl-foot-hint' }, t(settings ? 'hintSettings' : 'hint')),
          h(
            'span',
            { className: 'dshpl-foot-count' },
            filtering
              ? visible.length + ' / ' + prompts.length + t('countSuffix')
              : t('countPrefix') + prompts.length + t('countSuffix'),
          ),
        ),
      )
    }

    /**
     * The Settings section: the same library, maintained in place. Nothing on the page can
     * receive an insertion, so a card opens its editor instead of writing to a composer.
     * @param {{ t: Function }} props - The section's translate function.
     */
    function PromptSettingsPage({ t }) {
      return h(
        'section',
        { className: 'dshpl-settings', 'aria-label': t('tabTitle') },
        h(
          'div',
          { className: 'dshpl-settings-head' },
          h('h2', { className: 'dshpl-settings-title' }, t('tabTitle')),
          h('p', { className: 'dshpl-settings-intro' }, t('settingsIntro')),
        ),
        h(PromptLibraryBody, { t, variant: 'settings' }),
      )
    }

    //#endregion

    //#region registration

    /** Cordis plugin body for the browser half. */
    const plugin = {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)

        // The stylesheet serves the tab, the New Session trigger, and the overlay menu, so it is
        // installed with the plugin rather than rendered by any one of those components.
        ctx.effect(() => installStyles(), 'dsh-prompt-library: stylesheet')


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

        // Settings is where the library is maintained when the right Sidebar is closed. The same
        // list, minus the composer it would insert into.
        ctx.effect(
          () => ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: SETTINGS_ID,
            order: SETTINGS_ORDER,
            label: () => t('tabTitle'),
          }, (props) => h(PromptSettingsPage, { ...props, t }))),
          'dsh-prompt-library: settings section',
        )

        ctx.effect(
          () => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name: 'settings.section.icon',
            id: SETTINGS_ID,
          }, SettingsGlyph)),
          'dsh-prompt-library: settings icon',
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
