/**
 * Browser half of the turn-notify bundle.
 *
 * Two jobs:
 *
 *  1. Poll the Host's notice queue and raise each notice through the renderer's
 *     Web Notification API. That API is what makes the banner belong to DeepSeek
 *     Harness (app icon, app name) instead of "Script Editor", and its click
 *     handler lets the banner come back to the conversation that produced it.
 *  2. Render the Settings page with the switches, the permission state and a test
 *     button; the page is a thin form over the Host's settings endpoint.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-turn-notify',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** Copy namespace registered on the Client locale service. */
    const NS = 'turnNotify'
    /** Settings endpoint owned by the Host half. */
    const SETTINGS_PATH = '/dsh-turn-notify/settings'
    /** Notice queue endpoint owned by the Host half. */
    const PENDING_PATH = '/dsh-turn-notify/pending'
    /** How often the page asks the Host for new notices. */
    const POLL_MS = 1500
    /** Where the last shown notice sequence is remembered across reloads. */
    const LAST_SEQ_KEY = 'dsh-turn-notify:last-seq'

    const zh = {
      'section.title': '会话结果弹窗',
      'section.description': '在 macOS 通知中心弹出横幅：每轮对话出结果时，以及 DSH 等待你审批时。点击通知会回到对应的会话。',
      'category.turnEnd': '回复完成时弹窗',
      'category.turnEnd.hint': '每当一轮对话结束、回复准备好时弹出通知。',
      'category.approval': '等待审批时弹窗',
      'category.approval.hint': '当 DSH 停在「等待审批」上（例如要执行命令、修改文件）时弹出通知。',
      'sound': '播放提示音',
      'sound.hint': '关闭后通知仍会出现，但不会播放声音。',
      'saving': '正在保存…',
      'saved': '已保存',
      'saveFailed': '保存失败：{detail}',
      'loading': '正在读取设置…',
      'loadFailed': '读取设置失败：{detail}',
      'retry': '重试',
      'test': '发送测试通知',
      'testing': '已发送测试通知',
      'permission.granted': '系统通知权限：已允许',
      'permission.denied': '系统通知权限：已拒绝。请在系统设置 → 通知 → DeepSeek Harness 中允许。',
      'permission.default': '系统通知权限：尚未允许。',
      'permission.unsupported': '当前环境不支持系统通知。',
      'requestPermission': '允许通知',
      'clickHint': '点击通知会激活 DSH 并打开对应的会话。',
      'note': '通知会带会话名称和回复摘要；子代理会话默认不弹。',
    }

    const en = {
      'section.title': 'Turn result notifications',
      'section.description': 'macOS Notification Center banners: whenever a conversation turn produces its result, and while DSH is waiting for your approval. Clicking a banner returns to that conversation.',
      'category.turnEnd': 'Popup when a reply finishes',
      'category.turnEnd.hint': 'Show a notification when a turn ends and the reply is ready.',
      'category.approval': 'Popup while an approval is waiting',
      'category.approval.hint': 'Show a notification while DSH is waiting for your approval, such as running a command or editing a file.',
      'sound': 'Play alert sound',
      'sound.hint': 'With sound off, notifications still appear, silently.',
      'saving': 'Saving…',
      'saved': 'Saved',
      'saveFailed': 'Could not save: {detail}',
      'loading': 'Loading settings…',
      'loadFailed': 'Could not load settings: {detail}',
      'retry': 'Retry',
      'test': 'Send a test notification',
      'testing': 'Test notification sent',
      'permission.granted': 'System notification permission: allowed',
      'permission.denied': 'System notification permission: denied. Allow it in System Settings → Notifications → DeepSeek Harness.',
      'permission.default': 'System notification permission: not granted yet.',
      'permission.unsupported': 'This environment does not support system notifications.',
      'requestPermission': 'Allow notifications',
      'clickHint': 'Clicking a banner activates DSH and opens that conversation.',
      'note': 'A banner carries the conversation name and a reply preview; child-agent sessions stay quiet by default.',
    }

    const STYLES = `
.tn_section{display:flex;flex-direction:column;gap:16px;box-sizing:border-box;color:var(--dsw-alias-label-primary)}
.tn_header{display:flex;flex-direction:column;gap:6px}
.tn_title{margin:0;font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary)}
.tn_intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.tn_card{display:flex;flex-direction:column;padding:4px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.tn_row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tn_row:last-child{border-bottom:none}
.tn_rowText{display:flex;flex-direction:column;gap:4px;min-width:0}
.tn_rowLabel{font-size:13px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-primary)}
.tn_rowHint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.tn_switch{position:relative;display:inline-flex;flex:none;align-items:center;width:36px;height:20px;margin-top:2px;cursor:pointer}
.tn_switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.tn_track{position:absolute;inset:0;border-radius:10px;background:var(--dsw-alias-border-l2);transition:background-color .15s ease;pointer-events:none}
.tn_thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease;pointer-events:none;box-shadow:0 1px 2px rgb(0 0 0 / 20%)}
.tn_switch input:checked ~ .tn_track{background:var(--dsw-alias-brand-primary)}
.tn_switch input:checked ~ .tn_thumb{transform:translateX(16px)}
.tn_switch input:focus-visible ~ .tn_track{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.tn_switch input:disabled{cursor:default}
.tn_switch input:disabled ~ .tn_track{opacity:.5}
.tn_footer{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.tn_btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;line-height:18px;cursor:pointer}
.tn_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.tn_btn:disabled{opacity:.45;cursor:default}
.tn_status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.tn_error{color:var(--dsw-alias-state-error-primary)}
.tn_note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
`

    /** Notifications currently on screen, closed when the Client half unloads. */
    const active = new Set()

    /** @returns the last shown sequence, or null when this page never showed one. */
    const readLastSeq = () => {
      try {
        const raw = localStorage.getItem(LAST_SEQ_KEY)
        const value = Number(raw)
        return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
      } catch {
        return null
      }
    }

    /** Remember the last shown sequence so a reload does not replay it. */
    const writeLastSeq = (seq) => {
      try {
        localStorage.setItem(LAST_SEQ_KEY, String(seq))
      } catch {}
    }

    /** @returns the current Notification permission, without throwing. */
    const permissionOf = () => {
      try {
        return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
      } catch {
        return 'unsupported'
      }
    }

    /** Request the system notification permission once; safe to call repeatedly. */
    const requestPermission = () => {
      if (typeof Notification === 'undefined') return Promise.resolve('unsupported')
      try {
        if (Notification.permission !== 'default') return Promise.resolve(Notification.permission)
        return Notification.requestPermission().catch(() => 'default')
      } catch {
        return Promise.resolve('default')
      }
    }

    /** Resolve after `ms` milliseconds. */
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    /** @returns the session id the workspace selection currently points at. */
    const selectedSessionId = (workspace) => {
      try {
        return workspace?.selection?.getSnapshot?.()?.sessionId
      } catch {
        return undefined
      }
    }

    /**
     * Bring DSH forward and open the conversation that produced one notice.
     *
     * `uiWorkspace.openSession` takes the Session id itself (the same call the
     * sidebar and the archive page use); handing it a wrapper object makes the
     * workspace treat the target as unknown, which is how a click used to land on
     * a blank new session. A Session that the Client has not listed yet is
     * refreshed first, and the selection is checked afterwards.
     *
     * @param ctx - Client context.
     * @param item - one queue item from the Host.
     * @returns a promise that settles once the navigation was attempted.
     */
    const openConversation = async (ctx, item) => {
      try {
        window.focus()
      } catch {}
      const sessionId = typeof item?.sessionId === 'string' && item.sessionId !== ''
        ? item.sessionId
        : (typeof item?.target?.sessionId === 'string' ? item.target.sessionId : '')
      if (sessionId === '') return
      const workspace = ctx.get('uiWorkspace')
      const sessions = ctx.get('sessions')
      if (workspace === undefined && sessions === undefined) return

      /** @returns whether the Client already lists that Session. */
      const known = () => {
        try {
          return sessions?.list?.getSnapshot?.()?.byId?.[sessionId] !== undefined
        } catch {
          return false
        }
      }

      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (selectedSessionId(workspace) === sessionId) return
        if (attempt === 0) {
          try {
            if (typeof workspace?.openSession === 'function') workspace.openSession(sessionId)
            else if (typeof sessions?.open === 'function') sessions.open(sessionId)
          } catch (error) {
            console.warn('turn-notify: cannot open the conversation', error)
            return
          }
        } else if (!known() && attempt % 4 === 0) {
          try {
            await sessions?.refresh?.()
          } catch {}
        }
        await wait(120)
      }
    }

    /**
     * Raise one notice through the system notification center.
     * @param ctx - Client context.
     * @param item - one queue item from the Host.
     */
    const showNotice = (ctx, item) => {
      if (permissionOf() !== 'granted') return
      try {
        const notification = new Notification(String(item.title ?? 'DeepSeek Harness'), {
          body: String(item.body ?? ''),
          tag: String(item.id ?? ''),
          silent: item.silent === true,
        })
        active.add(notification)
        notification.onclick = () => {
          void openConversation(ctx, item)
          try {
            notification.close()
          } catch {}
        }
        notification.onclose = () => active.delete(notification)
        notification.onerror = () => active.delete(notification)
      } catch (error) {
        console.warn('turn-notify: cannot show notification', error)
      }
    }

    /**
     * Start polling the Host queue for notices this page has not shown yet.
     * @param ctx - Client context.
     * @returns disposer that stops the poller and closes open banners.
     */
    const startPoller = (ctx) => {
      let stopped = false
      let warned = false
      let lastSeq = readLastSeq()

      const tick = async () => {
        if (stopped) return
        if (permissionOf() === 'default') await requestPermission()
        if (permissionOf() !== 'granted') return
        try {
          const query = lastSeq === null ? '' : '?after=' + encodeURIComponent(String(lastSeq))
          const response = await fetch(PENDING_PATH + query, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const body = await response.json()
          if (!response.ok || body?.ok !== true) return
          // The Host restarted: its counter is below the one this page remembers,
          // so resync to its current sequence instead of waiting for it to catch up.
          if (body.reset === true) {
            lastSeq = Number.isFinite(body.seq) ? body.seq : 0
            writeLastSeq(lastSeq)
            return
          }
          if (Array.isArray(body.items)) {
            for (const item of body.items) showNotice(ctx, item)
          }
          if (Number.isFinite(body.seq)) {
            lastSeq = body.seq
            writeLastSeq(lastSeq)
          }
        } catch (error) {
          if (!warned) {
            warned = true
            console.warn('turn-notify: pending poll failed', error)
          }
        }
      }

      const timer = setInterval(() => {
        void tick()
      }, POLL_MS)
      void tick()
      return () => {
        stopped = true
        clearInterval(timer)
        for (const notification of active) {
          try {
            notification.close()
          } catch {}
        }
        active.clear()
      }
    }

    /** Bell glyph, also used as the Settings navigation icon. */
    function NotifyGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', { d: 'M8 2a3.5 3.5 0 0 0-3.5 3.5v2.2L3 11h10l-1.5-3.3V5.5A3.5 3.5 0 0 0 8 2z' }),
        h('path', { d: 'M6.5 13a1.6 1.6 0 0 0 3 0' }),
      )
    }

    /** One labelled switch row. */
    function SwitchRow(props) {
      const { label, hint, checked, disabled, onChange } = props
      return h(
        'div',
        { className: 'tn_row' },
        h(
          'div',
          { className: 'tn_rowText' },
          h('span', { className: 'tn_rowLabel' }, label),
          hint ? h('p', { className: 'tn_rowHint' }, hint) : null,
        ),
        h(
          'label',
          { className: 'tn_switch' },
          h('input', {
            type: 'checkbox',
            checked: checked === true,
            disabled: disabled === true,
            role: 'switch',
            'aria-checked': checked === true ? 'true' : 'false',
            'aria-label': label,
            onChange: (event) => onChange(event.target.checked),
          }),
          h('span', { className: 'tn_track', 'aria-hidden': true }),
          h('span', { className: 'tn_thumb', 'aria-hidden': true }),
        ),
      )
    }

    /** The Settings page. */
    function SettingsPage(props) {
      const t = props.t
      const [settings, setSettings] = React.useState({ turnEnd: true, approval: true, sound: true })
      const [status, setStatus] = React.useState('loading')
      const [error, setError] = React.useState('')
      const [errorKind, setErrorKind] = React.useState('load')
      const [testing, setTesting] = React.useState(false)
      const [permission, setPermission] = React.useState(() => permissionOf())

      const describe = (failure) => String(failure?.message ?? failure ?? '')

      /** Read the switches from the Host. */
      const load = React.useCallback(() => {
        setStatus('loading')
        setError('')
        fetch(SETTINGS_PATH, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => response.json().then((body) => ({ response, body })))
          .then(({ response, body }) => {
            if (!response.ok || body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`)
            setSettings({
              turnEnd: body.settings?.turnEnd !== false,
              approval: body.settings?.approval !== false,
              sound: body.settings?.sound !== false,
            })
            setStatus('ready')
          })
          .catch((failure) => {
            setStatus('error')
            setErrorKind('load')
            setError(describe(failure))
          })
      }, [])

      React.useEffect(() => {
        load()
        setPermission(permissionOf())
      }, [load])

      /** Save one switch change; the Host applies it without a restart. */
      const update = (key, value) => {
        const previous = settings
        setSettings({ ...settings, [key]: value })
        setStatus('saving')
        setError('')
        fetch(SETTINGS_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ settings: { [key]: value } }),
        })
          .then((response) => response.json().then((body) => ({ response, body })))
          .then(({ response, body }) => {
            if (!response.ok || body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`)
            setSettings({
              turnEnd: body.settings?.turnEnd !== false,
              approval: body.settings?.approval !== false,
              sound: body.settings?.sound !== false,
            })
            setStatus('saved')
          })
          .catch((failure) => {
            setSettings(previous)
            setStatus('error')
            setErrorKind('save')
            setError(describe(failure))
          })
      }

      /** Ask the Host to queue one test notice; this page's poller shows it. */
      const test = () => {
        setTesting(true)
        fetch(SETTINGS_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ action: 'test' }),
        })
          .then((response) => response.json())
          .catch(() => undefined)
          .finally(() => {
            setTesting(false)
            setStatus('ready')
            setError('')
          })
      }

      /** Ask the browser for the system notification permission. */
      const allow = () => {
        void requestPermission().then((result) => setPermission(result))
      }

      const busy = status === 'loading' || status === 'saving'
      let statusText = ''
      if (status === 'loading') statusText = t('loading')
      else if (status === 'saving') statusText = t('saving')
      else if (status === 'saved') statusText = t('saved')
      else if (status === 'ready') statusText = testing ? t('testing') : ''

      return h(
        'section',
        { className: 'tn_section', 'aria-label': t('section.title') },
        h('style', null, STYLES),
        h(
          'div',
          { className: 'tn_header' },
          h('h2', { className: 'tn_title' }, t('section.title')),
          h('p', { className: 'tn_intro' }, t('section.description')),
        ),
        h(
          'div',
          { className: 'tn_card' },
          h(SwitchRow, {
            label: t('category.turnEnd'),
            hint: t('category.turnEnd.hint'),
            checked: settings.turnEnd,
            disabled: busy,
            onChange: (value) => update('turnEnd', value),
          }),
          h(SwitchRow, {
            label: t('category.approval'),
            hint: t('category.approval.hint'),
            checked: settings.approval,
            disabled: busy,
            onChange: (value) => update('approval', value),
          }),
          h(SwitchRow, {
            label: t('sound'),
            hint: t('sound.hint'),
            checked: settings.sound,
            disabled: busy,
            onChange: (value) => update('sound', value),
          }),
        ),
        h(
          'div',
          { className: 'tn_footer' },
          h(
            'button',
            { type: 'button', className: 'tn_btn', onClick: test, disabled: testing },
            t('test'),
          ),
          permission !== 'granted'
            ? h('button', { type: 'button', className: 'tn_btn', onClick: allow }, t('requestPermission'))
            : null,
          status === 'error'
            ? h('span', { className: 'tn_status tn_error', role: 'alert' }, errorKind === 'load' ? t('loadFailed', { detail: error }) : t('saveFailed', { detail: error }))
            : h('span', { className: 'tn_status', role: 'status' }, statusText),
          status === 'error'
            ? h('button', { type: 'button', className: 'tn_btn', onClick: load }, t('retry'))
            : null,
        ),
        h('p', { className: 'tn_note' }, t('permission.' + permission)),
        h('p', { className: 'tn_note' }, t('note')),
        h('p', { className: 'tn_note' }, t('clickHint')),
      )
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        try {
          return ctx.locale.register(NS, { zh, en })
        } catch (error) {
          // A replaced bundle generation can finish registering before the
          // previous fiber's disposer runs; the existing dictionary is the same.
          console.warn('turn-notify: dictionaries already registered', error)
          return () => {}
        }
      }, 'turn-notify: dictionaries')

      ctx.effect(() => startPoller(ctx), 'turn-notify: notice poller')

      ctx.effect(
        () => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'turn-notify',
        }, NotifyGlyph)),
        'turn-notify: settings icon',
      )

      ctx.effect(
        () => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'turn-notify',
          order: 41,
          label: () => t('section.title'),
          inject: () => ({ t }),
        }, SettingsPage)),
        'turn-notify: settings page',
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
