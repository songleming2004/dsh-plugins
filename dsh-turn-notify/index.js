/**
 * Host half of the turn-notify bundle.
 *
 * Two moments in a conversation need the user's attention while they look
 * somewhere else: a turn produced its result (`turn/end`), and the Agent is
 * waiting on an approval (`approval/asked`).
 *
 * The Host is the only process that sees both for every Session, so this half
 * detects them and queues one notice per event. The **browser** half opens the
 * notice through the renderer's Web Notification API, which is what gives the
 * banner the DeepSeek Harness app icon and makes a click come back to the app —
 * an `osascript` banner belongs to "Script Editor" instead, with no icon and no
 * way to navigate. The opt-in `fallback` config keeps the old CLI banner for the
 * case where no page is open at all.
 *
 * The queue is served to the page over `GET /dsh-turn-notify/pending?after=<seq>`;
 * the page shows each item once and remembers its sequence.
 */

import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Route prefix owned by this plugin; the Web server matches it prefix-first. */
const ROUTE = '/dsh-turn-notify'
/** Settings endpoint served under the prefix. */
const SETTINGS_PATH = `${ROUTE}/settings`
/** Pending-notice endpoint served under the prefix. */
const PENDING_PATH = `${ROUTE}/pending`
/** Largest settings body accepted, in bytes. */
const BODY_LIMIT = 4096
/** Notices kept for a page that shows up late, and their lifetime. */
const QUEUE_LIMIT = 50
const QUEUE_TTL_MS = 5 * 60 * 1000
/** How long after the last page poll the Host stops trusting the page to show notices. */
const PAGE_LEASE_MS = 15000

/** Defaults; every field can be overridden by the row's `config` in cordis.patch.yml. */
const DEFAULTS = Object.freeze({
  enabled: true,
  /** `zh` or `en`; empty means `zh`. */
  language: 'zh',
  /** Bold first line of a fallback `osascript` banner. */
  titlePrefix: 'DSH',
  /** macOS alert sound name for the fallback banner; empty or unknown disables it. */
  soundName: 'Glass',
  /** Reply preview length in characters. */
  maxChars: 120,
  /** Also notify for child-agent turns (`session.header.origin === 'subagent'`). */
  includeSubagents: false,
  /** Also notify when a turn ends without a normal completion (stop, error). */
  notifyOnAbnormalEnd: true,
  /** Default for the Settings switch: banner when a reply finishes. */
  turnEnd: true,
  /** Default for the Settings switch: banner when an approval is requested. */
  approval: true,
  /** Default for the Settings switch: play the alert sound. */
  sound: true,
  /**
   * Opt-in CLI fallback: when no page is polling, raise the notice through
   * `osascript` (attributed to Script Editor). Off by default: the renderer
   * banner carries the app icon and navigates back to the conversation.
   */
  fallback: false,
})

/** Alert sounds macOS ships with; `osascript` rejects any other name. */
const SOUNDS = new Set([
  'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero',
  'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink',
])

/** User-facing strings, keyed by language. */
const COPY = {
  zh: {
    finished: '回复完成',
    stopped: '已停止',
    failed: '回复出错',
    ended: '本轮结束',
    approval: '等待审批',
    approvalBody: '有一步操作正在等待你的审批。',
    approvalReason: '原因',
    idle: 'DSH 会话',
    testTitle: '通知测试已发送',
    testBody: '如果你看到这条通知，会话结果弹窗已经可以正常弹出。',
  },
  en: {
    finished: 'Reply finished',
    stopped: 'Stopped',
    failed: 'Reply failed',
    ended: 'Turn ended',
    approval: 'Approval waiting',
    approvalBody: 'An action is waiting for your approval.',
    approvalReason: 'reason',
    idle: 'DSH conversation',
    testTitle: 'Notification test',
    testBody: 'If you can see this, the conversation popup works.',
  },
}

/** Reply preview per Session id, newest assistant message wins. */
const previews = new Map()
/** Generated or user-set title per Session id. */
const titles = new Map()
/** Approval ids already announced, so a re-ask after a reload is not news. */
const seenApprovals = new Map()
/** Bounded so a long-lived Host cannot grow these caches without limit. */
const CACHE_LIMIT = 500

const remember = (cache, key, value) => {
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
}

/**
 * Settings file path under the DSH home, so the switches survive a restart and
 * a plugin reinstall. This is plugin-owned state, not the profile's patch.
 * @returns the absolute path of the settings JSON file.
 */
function settingsFile() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'turn-notify', 'settings.json')
}

/** @returns the switch values found on disk, ignoring unknown or malformed fields. */
const readStored = (file) => {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const pick = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
    return {
      turnEnd: pick(raw?.turnEnd, undefined),
      approval: pick(raw?.approval, undefined),
      sound: pick(raw?.sound, undefined),
    }
  } catch {
    return {}
  }
}

/**
 * Persist the three switches. Failures are logged and never break the event feed.
 * @param file - settings file path.
 * @param values - `{ turnEnd, approval, sound }`.
 * @param logger - optional logger.
 */
function writeStored(file, values, logger) {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(values, null, 2) + '\n', 'utf8')
  } catch (error) {
    logger?.warn?.(`dsh-turn-notify: cannot save settings: ${error?.message ?? String(error)}`)
  }
}

/**
 * Flatten a message's content blocks into readable text.
 * @param content - `Message['content']`, an array of blocks.
 * @returns the concatenated text blocks, trimmed.
 */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      parts.push(block.text.trim())
    }
  }
  return parts.join('\n').trim()
}

/**
 * Collapse whitespace and clip a preview to a banner-friendly one-liner.
 * @param text - raw text.
 * @param maxChars - character budget.
 * @returns the clipped text.
 */
function clip(text, maxChars) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= maxChars) return flat
  return flat.slice(0, Math.max(1, maxChars - 1)).trimEnd() + '…'
}

/**
 * Read a `turn/end` reason, which is either a string or `{ kind }`.
 * @param reason - `event.data.reason`.
 * @returns the reason kind, or an empty string.
 */
function reasonOf(reason) {
  if (typeof reason === 'string') return reason
  if (reason !== null && typeof reason === 'object' && typeof reason.kind === 'string') return reason.kind
  return ''
}

/**
 * Pick the wording block for the configured language.
 * @param language - configured language.
 * @returns the copy block.
 */
const copyFor = (language) => (language === 'en' ? COPY.en : COPY.zh)

/**
 * Map a turn-end reason onto a short status label.
 * @param reason - reason kind.
 * @param words - copy block.
 * @returns the label for the banner title.
 */
function statusLabel(reason, words) {
  if (reason === 'completed' || reason === '') return words.finished
  if (reason === 'error' || reason === 'failed') return words.failed
  if (reason === 'user' || reason === 'aborted' || reason === 'stopped' || reason === 'cancelled') return words.stopped
  return words.ended
}

/**
 * Build the `osascript` argv for the optional CLI fallback banner.
 *
 * The AppleScript is fixed text; the user-visible strings are passed as `run`
 * arguments, so no value is ever interpolated into script source.
 * @param note - `{ body, title, subtitle, sound }`.
 * @returns the argv array for `osascript`.
 */
function scriptArgs({ body, title, subtitle, sound }) {
  const display = sound
    ? 'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv) sound name (item 4 of argv)'
    : 'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)'
  return [
    '-e', 'on run argv',
    '-e', display,
    '-e', 'end run',
    body, title, subtitle, sound ?? '',
  ]
}

/**
 * Raise one `osascript` banner (CLI fallback only).
 * @param note - `{ body, title, subtitle, sound }`.
 * @param logger - optional logger for a warning.
 */
function sendScriptBanner(note, logger) {
  execFile('/usr/bin/osascript', scriptArgs(note), { timeout: 8000, windowsHide: true }, (error) => {
    if (error) logger?.warn?.(`dsh-turn-notify: osascript failed: ${error.message ?? String(error)}`)
  })
}

/**
 * Read a bounded JSON body from one request.
 * @param req - incoming Node request.
 * @returns the parsed object.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(text)
        resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
      } catch {
        reject(new Error('bad-json'))
      }
    })
    req.on('error', (error) => reject(error))
  })
}

/**
 * Answer one `GET/POST /dsh-turn-notify/*` request.
 * @param req - incoming request.
 * @param res - response writer.
 * @param state - plugin state `{ settings, test, pending, markPolled, logger }`.
 */
async function handleRequest(req, res, state) {
  const headOnly = req.method === 'HEAD'
  const send = (status, payload) => {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(headOnly ? undefined : body)
  }
  let url
  try {
    url = new URL(String(req.url ?? ROUTE), 'http://turn-notify.invalid')
  } catch {
    send(400, { ok: false, message: 'Malformed request URL.' })
    return
  }

  if (url.pathname === PENDING_PATH) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(405, { ok: false, message: 'Only GET and HEAD are supported.' })
      return
    }
    state.markPolled()
    const rawAfter = url.searchParams.get('after')
    if (rawAfter === null) {
      // First run of a page: replay only the last minute and a half. A page that
      // has just been refreshed must not lose the approval that arrived while it
      // was reloading, and must not be flooded with older history either.
      send(200, { ok: true, ...state.pending.recent(Date.now() - 90_000) })
      return
    }
    const after = Number.parseInt(rawAfter, 10)
    send(200, { ok: true, ...state.pending.since(Number.isFinite(after) ? after : 0) })
    return
  }

  if (url.pathname !== SETTINGS_PATH) {
    send(404, { ok: false, message: 'Unknown turn-notify endpoint.' })
    return
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    send(200, { ok: true, settings: state.settings.get() })
    return
  }
  if (req.method !== 'POST') {
    send(405, { ok: false, message: 'Only GET, HEAD and POST are supported.' })
    return
  }
  // A page mutation must come from this origin; a missing Origin (curl, tests)
  // is left to the Web server's own authenticity gate.
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  if (origin !== '') {
    let sameOrigin = false
    try {
      sameOrigin = new URL(origin).host === req.headers.host
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) {
      send(403, { ok: false, message: 'Cross-origin request rejected.' })
      return
    }
  }
  let payload
  try {
    payload = await readJsonBody(req)
  } catch (error) {
    send(400, { ok: false, message: error?.message === 'body-too-large' ? 'Request body too large.' : 'Malformed JSON body.' })
    return
  }
  if (payload.action === 'test') {
    state.test()
    send(200, { ok: true, settings: state.settings.get(), tested: true })
    return
  }
  const candidate = payload.settings
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    send(400, { ok: false, message: 'Expected { settings: { turnEnd, approval, sound } }.' })
    return
  }
  const next = state.settings.update(candidate)
  if (next === null) {
    send(400, { ok: false, message: 'Settings values must be booleans.' })
    return
  }
  send(200, { ok: true, settings: next })
}

/**
 * Register the plugin on the Host context.
 * @param ctx - Host Cordis context.
 * @param config - the row's config from `cordis.patch.yml`.
 */
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config !== null && typeof config === 'object' ? config : {}) }
  if (cfg.enabled === false) return
  const language = cfg.language === 'en' ? 'en' : 'zh'
  const words = copyFor(language)
  const prefix = typeof cfg.titlePrefix === 'string' && cfg.titlePrefix.trim() !== '' ? cfg.titlePrefix.trim() : 'DSH'
  const maxChars = Number.isFinite(Number(cfg.maxChars)) ? Math.min(400, Math.max(20, Number(cfg.maxChars))) : DEFAULTS.maxChars
  const soundName = SOUNDS.has(cfg.soundName) ? cfg.soundName : ''
  const includeSubagents = cfg.includeSubagents === true
  const notifyOnAbnormalEnd = cfg.notifyOnAbnormalEnd !== false
  const fallback = cfg.fallback === true
  const file = settingsFile()
  const stored = readStored(file)

  /** Live switches; the Settings page changes these without a plugin restart. */
  let current = {
    turnEnd: typeof stored.turnEnd === 'boolean' ? stored.turnEnd : cfg.turnEnd !== false,
    approval: typeof stored.approval === 'boolean' ? stored.approval : cfg.approval !== false,
    sound: typeof stored.sound === 'boolean' ? stored.sound : cfg.sound !== false,
  }

  /** When the page last polled; the CLI fallback only fires after this lease lapses. */
  let lastPollAt = 0

  /** Notices waiting for the page, oldest first. */
  let queue = []
  let sequence = 0
  const at = () => Date.now()

  /**
   * Queue one notice for the page, optionally raising the CLI fallback when no
   * page is polling.
   * @param note - `{ title, body, kind, sessionId, sound }`.
   */
  const publish = (note) => {
    sequence += 1
    const item = {
      id: 'tn-' + sequence,
      seq: sequence,
      at: at(),
      title: note.title,
      body: note.body,
      kind: note.kind ?? 'info',
      silent: !current.sound,
      sessionId: note.sessionId ?? null,
      target: note.sessionId ? { kind: 'session', sessionId: note.sessionId } : null,
    }
    queue.push(item)
    const cutoff = at() - QUEUE_TTL_MS
    while (queue.length > QUEUE_LIMIT || (queue.length > 0 && queue[0].at < cutoff)) queue.shift()
    if (!fallback) return
    if (at() - lastPollAt < PAGE_LEASE_MS) return
    sendScriptBanner({
      title: `${prefix} · ${item.title}`,
      subtitle: '',
      body: item.body,
      sound: current.sound ? soundName : '',
    }, ctx.logger)
  }

  const pending = {
    current: () => sequence,
    since: (after) => {
      const items = queue.filter((item) => item.seq > after)
      // The Host's counter starts over at zero on every process start, while a page
      // keeps the last sequence it showed in localStorage. A page that survived a
      // restart therefore asks for numbers this Host will never reach; tell it to
      // resync instead of waiting forever.
      if (Number.isFinite(after) && after > sequence) {
        return { seq: sequence, items: [], reset: true }
      }
      return { seq: items.length > 0 ? items[items.length - 1].seq : after, items }
    },
    recent: (since) => {
      const items = queue.filter((item) => item.at >= since)
      return { seq: items.length > 0 ? items[items.length - 1].seq : sequence, items }
    },
  }

  /**
   * Session name used in the banner title: the generated title first, then the
   * Session header's own title, then the workspace folder name.
   * @param header - `session.header`.
   * @param id - session id.
   * @returns the display name.
   */
  const nameOf = (header, id) => {
    const known = titles.get(id)
    if (typeof known === 'string' && known.trim() !== '') return known.trim()
    if (typeof header?.title === 'string' && header.title.trim() !== '') return header.title.trim()
    if (typeof header?.cwd === 'string' && header.cwd !== '') {
      const base = header.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
      if (base) return base
    }
    return words.idle
  }

  /**
   * Handle one Session event. Wrapped by the caller so a malformed event can
   * never take the Host's event feed down.
   * @param session - the Session the event belongs to.
   * @param event - `{ type, data }`.
   */
  const handle = (session, event) => {
    const header = session?.header ?? {}
    const id = String(header.id ?? '')
    if (id === '' || event === null || typeof event !== 'object') return
    const type = event.type

    if (type === 'session/title') {
      const title = event.data?.title
      if (typeof title === 'string' && title.trim() !== '') remember(titles, id, title.trim())
      return
    }

    if (type === 'assistant/message') {
      const text = textOf(event.data?.message?.content)
      if (text !== '') remember(previews, id, text)
      return
    }

    if (type === 'approval/asked') {
      if (!current.approval) return
      if (!includeSubagents && header.origin === 'subagent') return
      const approvalId = String(event.data?.id ?? '')
      if (approvalId !== '') {
        if (seenApprovals.has(approvalId)) return
        remember(seenApprovals, approvalId, true)
      }
      const tool = typeof event.data?.toolName === 'string' && event.data.toolName.trim() !== ''
        ? event.data.toolName.trim()
        : ''
      const reason = typeof event.data?.reason === 'string' ? clip(event.data.reason, maxChars) : ''
      const detail = reason !== ''
        ? `${tool !== '' ? tool + ' · ' : ''}${words.approvalReason}: ${reason}`
        : tool !== '' ? `${tool} · ${words.approvalBody}` : words.approvalBody
      publish({
        title: clip(`${words.approval} · ${nameOf(header, id)}`, 90),
        body: clip(detail, maxChars),
        kind: 'approval',
        sessionId: id,
      })
      return
    }

    if (type !== 'turn/end') return
    if (!current.turnEnd) return
    if (!includeSubagents && header.origin === 'subagent') return

    const reason = reasonOf(event.data?.reason)
    const preview = previews.get(id) ?? ''
    previews.delete(id)
    if (reason !== 'completed' && reason !== '' && !notifyOnAbnormalEnd) return
    if (preview === '') return

    publish({
      title: clip(`${statusLabel(reason, words)} · ${nameOf(header, id)}`, 90),
      body: clip(preview, maxChars),
      kind: reason === '' || reason === 'completed' ? 'info' : 'warning',
      sessionId: id,
    })
  }

  const state = {
    settings: {
      get: () => ({ ...current }),
      update: (candidate) => {
        const next = { ...current }
        for (const key of ['turnEnd', 'approval', 'sound']) {
          if (candidate[key] === undefined) continue
          if (typeof candidate[key] !== 'boolean') return null
          next[key] = candidate[key]
        }
        current = next
        writeStored(file, next, ctx.logger)
        return { ...next }
      },
    },
    test: () => publish({ title: words.testTitle, body: words.testBody, kind: 'info' }),
    pending,
    markPolled: () => {
      lastPollAt = at()
    },
    logger: ctx.logger,
  }

  ctx.effect(() => {
    const offEvent = ctx.on('session/event', (session, event) => {
      try {
        handle(session, event)
      } catch (error) {
        ctx.logger?.warn?.(`dsh-turn-notify: event handler failed: ${error?.message ?? String(error)}`)
      }
    })
    const offDisposed = ctx.on('session/disposed', (session) => {
      const id = String(session?.header?.id ?? '')
      if (id !== '') {
        titles.delete(id)
        previews.delete(id)
      }
    })
    return () => {
      offEvent?.()
      offDisposed?.()
    }
  }, 'dsh-turn-notify: session feed')

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: (req, res) => handleRequest(req, res, state).catch((error) => {
          ctx.logger?.warn?.(`dsh-turn-notify: request failed: ${error?.message ?? String(error)}`)
          try {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: 'Internal error.' }))
          } catch {}
        }),
      }),
      'dsh-turn-notify: http routes',
    )
  })
}

/** Internals for the packaging check; the Loader ignores extra exports. */
export const __test = {
  textOf, clip, reasonOf, statusLabel, scriptArgs, settingsFile, readStored, writeStored,
  DEFAULTS, SOUNDS, ROUTE, SETTINGS_PATH, PENDING_PATH,
}
