/**
 * Browser half of the usage bundle.
 *
 * Two surfaces, both fed by one poll of the Host bridge, both able to show
 * either provider:
 *
 * 1. `sidebar.footer.action` — a card above the Settings button that reads
 *    like the cost meter's quota box: the provider, its plan and allowance on
 *    top, then the window and today's tokens.
 * 2. `settings.section` — the full figures: the allowance windows with reset
 *    times, today's and total tokens and cost per model, and the API key.
 *
 * **Which provider a surface shows** follows the session's model route: a
 * session on the `magpie` route shows Magpie's figures, a session on the
 * Mistral route shows Mistral's. A manual pick overrides that until the route
 * changes again — so switching models switches the card, and clicking the card
 * refreshes whatever it is showing.
 *
 * The Host half owns the keys, the probes and the ledgers; this half only
 * renders what it answers.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-mistral-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Bridge prefix served by the Host half; keep in sync with `index.js`. */
    const BRIDGE_PREFIX = '/api/mistral-usage'
    /** Locale namespace owned by this plugin. */
    const NS = 'mistral-usage'
    /** Settings navigation id, shared by the section and its icon. */
    const SETTINGS_ID = 'mistral-usage'
    /** Place of the Settings section: just after the cost meter's own page. */
    const SETTINGS_ORDER = 32
    /** Place of the sidebar card among the footer actions. */
    const FOOTER_ORDER = 1
    /** How often the page asks the Host for fresh figures. */
    const REFRESH_MS = 60_000
    /** The providers this bundle can show, in switch order. */
    const PROVIDERS = ['mistral', 'magpie']
    /** Magpie's usage windows, in the order the switch lists them. */
    const MAGPIE_PERIODS = ['today', '7d', '30d', 'all']
    /** Mistral's brand ramp for its progress bars (artwork colour, not a theme token). */
    const MISTRAL_GRADIENT = 'linear-gradient(90deg, #FFD800 0%, #FFAF00 45%, #FF8205 75%, #FA500F 100%)'
    /** Magpie's ramp: the bird's warm feather tones. */
    const MAGPIE_GRADIENT = 'linear-gradient(90deg, #7C5CFF 0%, #A855F7 45%, #EC4899 100%)'

    // #region copy

    /** English strings (key-set source of truth). */
    const en = {
      nav: 'Mistral usage',
      title: 'Mistral usage',
      intro: 'How much of the model provider’s allowance is used, and what this Harness spent through it.',
      plan: 'Plan',
      planUnknown: 'No plan reported',
      payg: 'Pay-as-you-go',
      apiBudget: 'API budget',
      todayTokens: 'Today',
      tokens: 'tokens',
      calls: 'calls',
      resets: 'Resets {date}',
      used: '{pct}% used',
      remaining: '{amount} left',
      openSettings: 'Open usage settings',
      clickToRefresh: 'Click to refresh',
      loading: 'Reading usage…',
      loadFailed: 'Could not read usage: {detail}',
      retry: 'Retry',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      updated: 'Updated {time}',
      accountTitle: 'Account allowance',
      accountHint: 'Read from the provider’s own usage API.',
      accountUnavailable: 'The provider reported no allowance.',
      harnessTitle: 'This Harness',
      harnessHint: 'Priced from the token usage recorded in this Harness’s session logs — every session, and it survives a restart.',
      magpieUsageTitle: 'Magpie traffic',
      magpieUsageHint: 'Read from the local Magpie gateway, which records every call it routed — including the calls other agents made through it.',
      today: 'Today',
      total: 'All sessions',
      estimatedCost: 'Estimated cost',
      inputTokens: 'Input',
      outputTokens: 'Output',
      cacheTokens: 'Cached',
      byModel: 'By model',
      model: 'Model',
      priceSource: 'Prices',
      priceConfig: 'your config',
      priceCatalog: 'pi-ai catalog',
      pricePublished: 'Mistral price list',
      priceDefault: 'default estimate',
      priceMagpie: 'Magpie',
      estimateNote: 'Estimated from token counts at the listed prices; the invoice is authoritative.',
      magpieNote: 'Priced by Magpie itself, from the prices it recorded for each call.',
      noModels: 'No calls have been recorded yet.',
      costMeterTitle: 'Cost meter',
      costMeterOn: 'Mirrored into the cost meter’s quota card “Mistral” — it appears on the sidebar and under Settings › Cost › Quotas.',
      costMeterOff: 'The cost meter is not reporting the Mistral card; install and enable dsh-cost-meter to see it beside the other plans.',
      keyTitle: 'API key',
      keyHint: 'The key is stored by this Harness’s credential service as {ref}; it never reaches this page.',
      magpieKeyHint: 'Magpie answers on the loopback interface; a key is only needed when the gateway is shared on the network.',
      keyConfigured: 'Configured',
      keyMissing: 'Not configured',
      keyOptional: 'Not required',
      keySource: 'Source: {source}',
      keyInput: 'Mistral API key',
      magpieKeyInput: 'Magpie gateway key',
      keyPlaceholder: 'Paste a key to replace the stored one',
      magpieKeyPlaceholder: 'Optional: paste a gateway key',
      keySave: 'Save key',
      keyClear: 'Remove key',
      keySaved: 'Key saved.',
      keyCleared: 'Key removed.',
      missingKey: 'No Mistral API key is configured yet. Add one below.',
      invalidKey: 'The Mistral API refused this key: {detail}',
      unavailable: 'The billing API returned no allowance for this key; usage is only reported for keys on a metered plan.',
      settingsIntro: 'Shows the provider allowance and this Harness’s spend on the sidebar and in Settings.',
      providerMistral: 'Mistral',
      providerMagpie: 'Magpie',
      switchProvider: 'Which provider to show',
      followingRoute: 'Following this session’s model route',
      manualPick: 'Showing {name} — click to follow the session again',
      magpieOffline: 'Magpie is not answering at {url}. Start the Magpie app, or set magpieBaseURL to where its gateway listens.',
      magpieRefused: 'Magpie refused the gateway key. Check the key below, or clear it if the gateway is not shared.',
      magpieUnavailable: 'Magpie reported no figures: {detail}',
      magpiePlan: 'Subscription',
      magpiePeriod: 'Window',
      periodToday: 'Today',
      period7d: '7 days',
      period30d: '30 days',
      periodAll: 'All',
      errors: '{n} errors',
      unpriced: '{n} unpriced',
      byAgent: 'By agent',
      agent: 'Agent',
      sessions: 'Sessions',
      magpiePath: 'Recorded in {path}',
      subscriptionLead: 'Leading {name}',
      noSubscriptions: 'Magpie reports no subscription windows right now.',
    }

    /** Simplified Chinese dictionary with the same keys. */
    const zh = {
      nav: 'Mistral 用量',
      title: 'Mistral 用量',
      intro: '模型服务商的额度使用情况，以及本 Harness 通过它产生的花费。',
      plan: '套餐',
      planUnknown: '未返回套餐',
      payg: '按量付费',
      apiBudget: 'API 额度',
      todayTokens: '今日',
      tokens: 'tokens',
      calls: '次请求',
      resets: '{date} 重置',
      used: '已用 {pct}%',
      remaining: '剩余 {amount}',
      openSettings: '打开用量设置',
      clickToRefresh: '点击刷新',
      loading: '正在读取用量…',
      loadFailed: '无法读取用量：{detail}',
      retry: '重试',
      refresh: '刷新',
      refreshing: '正在刷新…',
      updated: '更新于 {time}',
      accountTitle: '账户额度',
      accountHint: '从服务商自己的用量接口读取。',
      accountUnavailable: '服务商未返回额度。',
      harnessTitle: '本 Harness',
      harnessHint: '按本 Harness 会话日志中记录的 token 用量计价——覆盖所有会话，重启后依然保留。',
      magpieUsageTitle: 'Magpie 流量',
      magpieUsageHint: '从本机 Magpie 网关读取：它记录了经它转发的每一次调用，包括其他 agent 的调用。',
      today: '今日',
      total: '全部会话',
      estimatedCost: '预估费用',
      inputTokens: '输入',
      outputTokens: '输出',
      cacheTokens: '缓存',
      byModel: '按模型',
      model: '模型',
      priceSource: '价格来源',
      priceConfig: '你的配置',
      priceCatalog: 'pi-ai 目录',
      pricePublished: 'Mistral 价目表',
      priceDefault: '默认估算',
      priceMagpie: 'Magpie',
      estimateNote: '按 token 用量与所列单价估算，最终以账单为准。',
      magpieNote: '由 Magpie 按其记录的每次调用单价计价。',
      noModels: '还没有记录到请求。',
      costMeterTitle: '费用计量',
      costMeterOn: '已同步到费用计量插件的额度卡片「Mistral」，可在侧边栏与「设置 › 费用 › 额度」中看到。',
      costMeterOff: '费用计量插件尚未上报 Mistral 卡片；安装并启用 dsh-cost-meter 后即可与其他套餐并列显示。',
      keyTitle: 'API Key',
      keyHint: 'Key 由本 Harness 的凭据服务以 {ref} 保存，不会出现在此页面。',
      magpieKeyHint: 'Magpie 在回环地址上应答；只有把网关共享到局域网时才需要 Key。',
      keyConfigured: '已配置',
      keyMissing: '未配置',
      keyOptional: '无需配置',
      keySource: '来源：{source}',
      keyInput: 'Mistral API Key',
      magpieKeyInput: 'Magpie 网关 Key',
      keyPlaceholder: '粘贴新的 Key 以替换已保存的 Key',
      magpieKeyPlaceholder: '可选：粘贴网关 Key',
      keySave: '保存 Key',
      keyClear: '移除 Key',
      keySaved: 'Key 已保存。',
      keyCleared: 'Key 已移除。',
      missingKey: '尚未配置 Mistral API Key，请在下方添加。',
      invalidKey: 'Mistral API 拒绝了这个 Key：{detail}',
      unavailable: '账单 API 未返回此 Key 的额度；只有计费套餐的 Key 才会返回用量。',
      settingsIntro: '在侧边栏与设置页显示服务商额度与本 Harness 的花费。',
      providerMistral: 'Mistral',
      providerMagpie: 'Magpie',
      switchProvider: '显示哪个服务商',
      followingRoute: '跟随本会话的模型来源',
      manualPick: '正在显示 {name} —— 点击可恢复跟随会话',
      magpieOffline: 'Magpie 未在 {url} 应答。请启动 Magpie 应用，或把 magpieBaseURL 改成网关实际监听的地址。',
      magpieRefused: 'Magpie 拒绝了网关 Key。请检查下方 Key，若网关未共享可清空。',
      magpieUnavailable: 'Magpie 未返回数据：{detail}',
      magpiePlan: '订阅',
      magpiePeriod: '统计窗口',
      periodToday: '今日',
      period7d: '7 天',
      period30d: '30 天',
      periodAll: '全部',
      errors: '{n} 次错误',
      unpriced: '{n} 次未定价',
      byAgent: '按 agent',
      agent: 'Agent',
      sessions: '会话',
      magpiePath: '记录于 {path}',
      subscriptionLead: '当前使用 {name}',
      noSubscriptions: 'Magpie 当前没有上报订阅额度窗口。',
    }

    // #endregion

    // #region formatting

    /**
     * Format a currency amount.
     * @param {number | null | undefined} value - amount.
     * @param {string} currency - currency code.
     * @returns {string} display string.
     */
    function money(value, currency) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const code = currency || 'USD'
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: code,
          minimumFractionDigits: 2,
          maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
        }).format(value)
      } catch {
        return `${value.toFixed(2)} ${code}`
      }
    }

    /**
     * Format a token count the way the cost meter does: 1.2K, 41.8M.
     * @param {number | null | undefined} value - count.
     * @returns {string} display string.
     */
    function tokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value < 1000) return String(Math.round(value))
      if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`
      return `${(value / 1_000_000).toFixed(1)}M`
    }

    /**
     * Format a reset timestamp as a short local date and time.
     * @param {string | undefined} iso - ISO timestamp from the provider.
     * @returns {string} display text, or an em dash.
     */
    function resetLabel(iso) {
      if (typeof iso !== 'string' || iso.length === 0) return '—'
      const when = new Date(iso)
      if (Number.isNaN(when.getTime())) return '—'
      try {
        return when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      } catch {
        return iso.slice(0, 16).replace('T', ' ')
      }
    }

    /**
     * One budget's percentage, clamped for the bar.
     * @param {{ percent?: number } | undefined} budget - budget view.
     * @returns {number} 0-100.
     */
    function percentOf(budget) {
      const value = Number(budget?.percent)
      if (!Number.isFinite(value)) return 0
      return Math.max(0, Math.min(100, value))
    }

    /**
     * Total tokens of one priced day.
     * @param {object | undefined} day - priced day.
     * @returns {number} token count.
     */
    function dayTokens(day) {
      if (day === null || typeof day !== 'object') return 0
      return (
        (Number(day.input) || 0) +
        (Number(day.output) || 0) +
        (Number(day.cacheRead) || 0) +
        (Number(day.cacheWrite) || 0) +
        (Number(day.reasoning) || 0)
      )
    }

    /**
     * Replace `{name}` placeholders.
     * @param {string} text - template.
     * @param {Record<string, string>} params - values.
     * @returns {string} filled text.
     */
    function fill(text, params) {
      return String(text).replace(/\{(\w+)\}/g, (whole, key) => (params[key] !== undefined ? String(params[key]) : whole))
    }

    // #endregion

    // #region bridge

    /**
     * Call one bridge endpoint.
     * @param {string} path - endpoint name under the prefix.
     * @param {object} body - JSON body.
     * @returns {Promise<any>} the answer.
     */
    async function callBridge(path, body) {
      const response = await fetch(`${BRIDGE_PREFIX}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const answer = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(answer?.error ?? `HTTP ${response.status}`)
      return answer
    }

    /**
     * A tiny observable store, so the sidebar card and the Settings page share
     * one poll.
     * @param {unknown} initial - initial snapshot.
     */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe: (fn) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        set: (next) => {
          state = next
          for (const fn of listeners) fn()
        },
      }
    }

    /**
     * Live usage snapshot shared by the sidebar card and the Settings page.
     *
     * `provider` is the manual pick (null while following the session),
     * `route` is the provider the current session's model route belongs to,
     * and `shown` is what the surfaces actually render.
     */
    const usageStore = createStore({
      status: 'loading',
      data: null,
      error: null,
      at: 0,
      language: 'en',
      busy: false,
      pick: null,
      route: null,
      period: '30d',
    })

    /** The in-flight refresh, so a click and a poll never run two at once. */
    let inFlight = null

    /**
     * The session whose route the card follows. The Host tracks providers per
     * session, so naming the one on screen keeps the card on *this*
     * conversation rather than on whichever route spoke last.
     */
    let activeSessionId = null

    /**
     * The provider a surface should show: the manual pick, else the session's
     * route, else Mistral (the bundle's original subject).
     * @param {object} snap - the snapshot.
     * @returns {'mistral' | 'magpie'} the provider.
     */
    function shownProvider(snap) {
      if (snap.pick !== null) return snap.pick
      if (snap.route !== null) return snap.route
      return 'mistral'
    }

    /**
     * Refresh the shared snapshot from the Host.
     * @param {boolean} refresh - ask the Host to re-read the provider.
     * @returns {Promise<void>}
     */
    function load(refresh) {
      if (inFlight !== null) return inFlight
      const forced = refresh === true
      const snap = usageStore.getSnapshot()
      if (forced) usageStore.set({ ...snap, busy: true })
      // The manual pick is sent as the provider; without one the Host follows
      // the session itself, so the answer carries the route it resolved.
      const body = { refresh: forced, period: snap.period }
      if (snap.pick !== null) body.provider = snap.pick
      if (activeSessionId !== null) body.sessionId = activeSessionId
      inFlight = (async () => {
        try {
          const data = await callBridge('summary', body)
          const route = typeof data?.followed === 'string' ? data.followed : null
          const current = usageStore.getSnapshot()
          usageStore.set({
            ...current,
            status: 'ready',
            data,
            error: null,
            at: Date.now(),
            busy: false,
            route,
            // A manual pick that now matches the route is no longer a pick:
            // the session moved onto it, so the card goes back to following.
            pick: current.pick !== null && current.pick === route ? null : current.pick,
          })
        } catch (error) {
          const previous = usageStore.getSnapshot()
          usageStore.set({
            ...previous,
            status: previous.data === null ? 'error' : 'ready',
            error: error instanceof Error ? error.message : String(error),
            busy: false,
          })
        } finally {
          inFlight = null
        }
      })()
      return inFlight
    }

    /**
     * Choose a provider by hand, or go back to following the session.
     * @param {'mistral' | 'magpie' | null} provider - the pick, or null to follow.
     * @returns {Promise<void>}
     */
    async function chooseProvider(provider) {
      const snap = usageStore.getSnapshot()
      usageStore.set({ ...snap, pick: provider === null ? null : provider })
      await load(true)
    }

    /**
     * Choose a Magpie usage window.
     * @param {string} period - one of the Magpie periods.
     * @returns {Promise<void>}
     */
    async function choosePeriod(period) {
      const snap = usageStore.getSnapshot()
      usageStore.set({ ...snap, period })
      await load(true)
    }

    /**
     * Subscribe a component to the shared snapshot.
     * @returns {object} the snapshot.
     */
    function useUsage() {
      return React.useSyncExternalStore(usageStore.subscribe, usageStore.getSnapshot)
    }

    // #endregion

    // #region components

    /** The settings navigation glyph: a gauge dial. */
    function UsageGlyph() {
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
        h('path', { d: 'M2.6 12.2a6 6 0 1 1 10.8 0' }),
        h('path', { d: 'M8 12.2 11 7.6' }),
        h('circle', { cx: 8, cy: 12.2, r: 0.9, fill: 'currentColor', stroke: 'none' }),
      )
    }

    /**
     * The provider switch: one segment per provider, plus a note when a manual
     * pick is overriding the session's route.
     * @param {{ provider: string, pick: string | null, route: string | null, onPick: Function, compact?: boolean }} props - switch state.
     */
    function ProviderSwitch({ provider, pick, route, onPick, compact }) {
      const t = useT()
      const name = (id) => (id === 'magpie' ? t('providerMagpie') : t('providerMistral'))
      return h(
        'div',
        { className: compact ? 'mu-switch mu-switch-compact' : 'mu-switch', role: 'group', 'aria-label': t('switchProvider') },
        PROVIDERS.map((id) =>
          h(
            'button',
            {
              key: id,
              type: 'button',
              className: `mu-switch-seg${provider === id ? ' mu-switch-on' : ''}`,
              'aria-pressed': provider === id ? 'true' : 'false',
              onClick: (event) => {
                event.stopPropagation()
                if (pick === id) onPick(null)
                else onPick(id)
              },
            },
            name(id),
          ),
        ),
        pick !== null && route !== null && pick !== route
          ? h('span', { className: 'mu-switch-note' }, t('manualPick', { name: name(pick) }))
          : null,
      )
    }

    /**
     * One labelled progress bar, the shape the cost meter's quota cards use.
     * @param {{ label: string, percent: number, valueText: string, hint?: string, title?: string, magpie?: boolean }} props - row content.
     */
    function QuotaRow({ label, percent, valueText, hint, title, magpie }) {
      const width = `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`
      return h(
        'div',
        { className: 'mu-row', title: title ?? undefined },
        h('span', { className: 'mu-row-label' }, label),
        h('div', { className: 'mu-row-bar' }, h('div', { className: magpie ? 'mu-row-fill mu-row-fill-magpie' : 'mu-row-fill', style: { width } })),
        h('span', { className: 'mu-row-value' }, valueText),
        hint ? h('span', { className: 'mu-row-hint' }, hint) : null,
      )
    }

    /**
     * The sidebar card: provider, plan, the allowance and today's tokens.
     * Clicking it re-reads the figures from the Host.
     * @param {{ wide?: boolean }} props - owner props (whether the sidebar is wide).
     */
    function SidebarUsageCard({ wide }) {
      const snap = useUsage()
      const t = useT()
      const data = snap.data
      const provider = shownProvider(snap)
      const isMagpie = provider === 'magpie'
      const bar = data?.provider === provider ? data?.bar : undefined
      // Magpie reports its figures under `usage`; the Host also mirrors them as
      // `ledger`, and either name works here.
      const ledger = data?.provider === provider ? (data?.ledger ?? data?.usage) : undefined
      const today = ledger?.today
      const percent = percentOf(bar)
      const valueText = bar !== undefined ? `${Math.round(percent)}%` : '—'
      const label = isMagpie ? t('providerMagpie') : t('nav')
      const busy = snap.busy === true
      const plan =
        data?.provider === provider && typeof data.plan === 'string' && data.plan.length > 0
          ? data.plan
          : snap.status === 'loading'
            ? t('loading')
            : t('planUnknown')
      // A Magpie gateway that is not running says so instead of showing a zero.
      const offline = isMagpie && data?.provider === 'magpie' && (data.status === 'unreachable' || data.status === 'refused')

      /** Refresh on click, and on Enter/Space for keyboard users. */
      const refresh = () => {
        if (!busy) load(true)
      }
      const interactive = {
        role: 'button',
        tabIndex: 0,
        'aria-busy': busy ? 'true' : 'false',
        onClick: refresh,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            refresh()
          }
        },
      }
      const hint = busy ? t('refreshing') : t('clickToRefresh')
      const title = `${label} · ${valueText} · ${hint}`

      if (wide === false) {
        // Collapsed rail: a 40px tile carrying the ring and the percentage.
        return h(
          'div',
          {
            ...interactive,
            className: `mu-rail mu-clickable${busy ? ' mu-busy' : ''}`,
            title,
            'aria-label': `${label} ${valueText} · ${hint}`,
            'data-provider': provider,
          },
          h('svg', { viewBox: '0 0 36 36', width: 26, height: 26, 'aria-hidden': true },
            h('circle', { cx: 18, cy: 18, r: 14, fill: 'none', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 4 }),
            h('circle', {
              className: 'mu-ring-fill',
              cx: 18,
              cy: 18,
              r: 14,
              fill: 'none',
              stroke: isMagpie ? '#A855F7' : '#FF8205',
              strokeWidth: 4,
              strokeLinecap: 'round',
              strokeDasharray: `${(percent / 100) * 87.96} 87.96`,
              transform: 'rotate(-90 18 18)',
            }),
          ),
          h('span', { className: 'mu-rail-value' }, valueText),
        )
      }

      return h(
        'div',
        {
          className: `mu-card${busy ? ' mu-busy' : ''}`,
          title,
          'data-plugin': '@local/dsh-mistral-usage',
          'data-provider': provider,
        },
        h(
          'div',
          { className: 'mu-card-head' },
          h(
            'div',
            { ...interactive, className: 'mu-card-title-hit', 'aria-label': `${label} · ${hint}` },
            h('span', { className: 'mu-card-title' }, label),
          ),
          h('span', { className: 'mu-card-plan' }, plan),
        ),
        h(ProviderSwitch, {
          provider,
          pick: snap.pick,
          route: snap.route,
          onPick: chooseProvider,
          compact: true,
        }),
        offline
          ? h('div', { className: 'mu-line mu-line-error' }, t('magpieOffline', { url: data.baseURL ?? '' }))
          : null,
        bar !== undefined && !offline
          ? h(
              'div',
              { className: 'mu-card-bar' },
              h('div', { className: isMagpie ? 'mu-card-fill mu-card-fill-magpie' : 'mu-card-fill', style: { width: `${percent.toFixed(1)}%` } }),
            )
          : null,
        h(
          'div',
          { className: 'mu-card-lines' },
          bar !== undefined && !offline
            ? h(
                'div',
                { className: 'mu-line' },
                h(
                  'span',
                  { className: 'mu-line-label' },
                  bar.source === 'account' ? (isMagpie ? bar.budget ?? t('apiBudget') : t('apiBudget')) : t('estimatedCost'),
                ),
                h(
                  'span',
                  { className: 'mu-line-value' },
                  bar.max !== undefined && bar.max !== null
                    ? `${money(bar.value, bar.currency)} / ${money(bar.max, bar.currency)}`
                    : money(bar.value, bar.currency),
                ),
              )
            : null,
          bar?.resetAt !== undefined && !offline
            ? h('div', { className: 'mu-line mu-line-quiet' }, h('span', { className: 'mu-line-label' }, t('resets', { date: resetLabel(bar.resetAt) })))
            : null,
          today !== undefined && !offline
            ? h(
                'div',
                { className: 'mu-line' },
                h('span', { className: 'mu-line-label' }, t('todayTokens')),
                h('span', { className: 'mu-line-value' }, `${tokens(dayTokens(today))} ${t('tokens')}`),
              )
            : null,
          today !== undefined && today.calls > 0 && !offline
            ? h(
                'div',
                { className: 'mu-line mu-line-quiet' },
                h('span', { className: 'mu-line-label' }, t('calls')),
                h('span', { className: 'mu-line-value' }, `${today.calls} · ${money(today.cost, 'USD')}`),
              )
            : null,
          snap.status === 'error'
            ? h('div', { className: 'mu-line mu-line-error' }, t('loadFailed', { detail: snap.error ?? '' }))
            : null,
        ),
      )
    }

    /**
     * A settings card wrapper.
     * @param {{ title: string, hint?: string, children?: any }} props - card content.
     */
    function Card({ title, hint, children }) {
      return h(
        'section',
        { className: 'mu-section-card' },
        h(
          'div',
          { className: 'mu-section-card-head' },
          h('h3', { className: 'mu-section-card-title' }, title),
          hint ? h('p', { className: 'mu-section-card-hint' }, hint) : null,
        ),
        children,
      )
    }

    /**
     * The per-model table, shared by both providers.
     * @param {{ rows: object[], note: string, magpie: boolean }} props - table content.
     */
    function ModelTable({ rows, note, magpie }) {
      const t = useT()
      return h(
        'div',
        { className: 'mu-table-wrap' },
        h('h4', { className: 'mu-subtitle' }, t('byModel')),
        (rows ?? []).length === 0
          ? h('p', { className: 'mu-empty' }, t('noModels'))
          : h(
              'table',
              { className: 'mu-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, t('model')),
                  h('th', { className: 'mu-num' }, t('calls')),
                  h('th', { className: 'mu-num' }, t('inputTokens')),
                  h('th', { className: 'mu-num' }, t('outputTokens')),
                  h('th', { className: 'mu-num' }, t('cacheTokens')),
                  h('th', { className: 'mu-num' }, t('estimatedCost')),
                  h('th', null, t('priceSource')),
                ),
              ),
              h(
                'tbody',
                null,
                (rows ?? []).map((entry) =>
                  h(
                    'tr',
                    { key: entry.model },
                    h('td', { className: 'mu-mono' }, entry.model),
                    h('td', { className: 'mu-num' }, String(entry.calls ?? 0)),
                    h('td', { className: 'mu-num' }, tokens(entry.input)),
                    h('td', { className: 'mu-num' }, tokens(entry.output)),
                    h('td', { className: 'mu-num' }, tokens((entry.cacheRead ?? 0) + (entry.cacheWrite ?? 0))),
                    h('td', { className: 'mu-num' }, money(entry.cost, 'USD')),
                    h('td', null, magpie ? t('priceMagpie') : priceSourceLabel(entry.priceSource, t)),
                  ),
                ),
              ),
            ),
        h('p', { className: 'mu-note' }, note),
      )
    }

    /**
     * The Magpie figures: subscriptions, the traffic window and the breakdown.
     * @param {{ data: object, snap: object }} props - the Host answer.
     */
    function MagpieFigures({ data, snap }) {
      const t = useT()
      const usage = data.usage
      const subscriptions = data.subscriptions ?? []
      const offline = data.status === 'unreachable' || data.status === 'refused'
      const total = usage?.total
      const today = usage?.today
      return h(
        React.Fragment,
        null,
        offline
          ? h(
              'div',
              { className: 'mu-notice mu-notice-error', role: 'alert' },
              data.status === 'refused'
                ? t('magpieRefused')
                : t('magpieOffline', { url: data.baseURL ?? '' }),
            )
          : null,
        data.status === 'unavailable'
          ? h('div', { className: 'mu-notice', role: 'status' }, t('magpieUnavailable', { detail: data.message ?? '' }))
          : null,

        h(
          Card,
          { title: t('accountTitle'), hint: t('accountHint') },
          subscriptions.length === 0
            ? h('p', { className: 'mu-empty' }, t('noSubscriptions'))
            : h(
                'div',
                { className: 'mu-quota-list' },
                subscriptions.map((subscription) =>
                  h(
                    'div',
                    { key: subscription.provider, className: 'mu-sub-quota' },
                    h(
                      'div',
                      { className: 'mu-sub-head' },
                      h('span', { className: 'mu-sub-name' }, subscription.name),
                      subscription.plan !== undefined ? h('span', { className: 'mu-card-plan' }, subscription.plan) : null,
                      subscription.last === true ? h('span', { className: 'mu-badge' }, '●') : null,
                    ),
                    subscription.windows.map((window) =>
                      h(QuotaRow, {
                        key: window.name,
                        label: window.name,
                        percent: percentOf(window),
                        valueText: t('used', { pct: percentOf(window).toFixed(1) }),
                        hint:
                          window.limit !== undefined
                            ? `${money(window.spent, window.currency ?? 'USD')} / ${money(window.limit, window.currency ?? 'USD')}${window.resetAt !== undefined ? ` · ${t('resets', { date: resetLabel(window.resetAt) })}` : ''}`
                            : window.resetAt !== undefined
                              ? t('resets', { date: resetLabel(window.resetAt) })
                              : undefined,
                        title:
                          window.remaining !== undefined
                            ? t('remaining', { amount: money(window.remaining, window.currency ?? 'USD') })
                            : undefined,
                        magpie: true,
                      }),
                    ),
                  ),
                ),
              ),
        ),

        h(
          Card,
          { title: t('magpieUsageTitle'), hint: t('magpieUsageHint') },
          h(
            'div',
            { className: 'mu-periods', role: 'group', 'aria-label': t('magpiePeriod') },
            MAGPIE_PERIODS.map((period) =>
              h(
                'button',
                {
                  key: period,
                  type: 'button',
                  className: `mu-period${snap.period === period ? ' mu-period-on' : ''}`,
                  'aria-pressed': snap.period === period ? 'true' : 'false',
                  onClick: () => choosePeriod(period),
                },
                t(period === 'today' ? 'periodToday' : period === '7d' ? 'period7d' : period === '30d' ? 'period30d' : 'periodAll'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'mu-figures' },
            h(
              'div',
              { className: 'mu-figure' },
              h('span', { className: 'mu-figure-label' }, t('total')),
              h('span', { className: 'mu-figure-value' }, `${tokens(dayTokens(total))} ${t('tokens')}`),
              h(
                'span',
                { className: 'mu-figure-sub' },
                `${total?.calls ?? 0} ${t('calls')} · ${money(total?.cost ?? 0, 'USD')}` +
                  (total?.errors > 0 ? ` · ${t('errors', { n: String(total.errors) })}` : ''),
              ),
            ),
            h(
              'div',
              { className: 'mu-figure' },
              h('span', { className: 'mu-figure-label' }, t('today')),
              h('span', { className: 'mu-figure-value' }, `${tokens(dayTokens(today))} ${t('tokens')}`),
              h('span', { className: 'mu-figure-sub' }, `${today?.calls ?? 0} ${t('calls')} · ${money(today?.cost ?? 0, 'USD')}`),
            ),
            h(
              'div',
              { className: 'mu-figure' },
              h('span', { className: 'mu-figure-label' }, t('estimatedCost')),
              h('span', { className: 'mu-figure-value' }, money(total?.cost ?? 0, 'USD')),
              h('span', { className: 'mu-figure-sub' }, `${t('inputTokens')} / ${t('outputTokens')} / ${t('cacheTokens')}`),
            ),
            usage?.sessionCount > 0
              ? h(
                  'div',
                  { className: 'mu-figure' },
                  h('span', { className: 'mu-figure-label' }, t('sessions')),
                  h('span', { className: 'mu-figure-value' }, String(usage.sessionCount)),
                )
              : null,
          ),
          h(ModelTable, { rows: usage?.byModel ?? [], note: t('magpieNote'), magpie: true }),
          (usage?.agents ?? []).length > 0
            ? h(
                'div',
                { className: 'mu-table-wrap' },
                h('h4', { className: 'mu-subtitle' }, t('byAgent')),
                h(
                  'table',
                  { className: 'mu-table' },
                  h('thead', null, h('tr', null, h('th', null, t('agent')), h('th', { className: 'mu-num' }, t('calls')), h('th', { className: 'mu-num' }, t('estimatedCost')))),
                  h(
                    'tbody',
                    null,
                    usage.agents.map((agent) =>
                      h(
                        'tr',
                        { key: agent.id },
                        h('td', null, agent.name),
                        h('td', { className: 'mu-num' }, String(agent.calls)),
                        h('td', { className: 'mu-num' }, money(agent.cost, 'USD')),
                      ),
                    ),
                  ),
                ),
              )
            : null,
          usage?.path !== undefined ? h('p', { className: 'mu-note mu-note-quiet' }, t('magpiePath', { path: usage.path })) : null,
        ),
      )
    }

    /**
     * The Mistral figures: the API budget and this Harness's own spend.
     * @param {{ data: object, snap: object }} props - the Host answer.
     */
    function MistralFigures({ data }) {
      const t = useT()
      const consumption = data.consumption
      const ledger = data.ledger
      const today = ledger?.today
      const total = ledger?.total
      // Only the API budget is shown: the Vibe allowance is spent by Vibe inside
      // its own harness, not by this API key, so listing it here would read as
      // spend that never happened.
      const budgets = []
      if (consumption?.status === 'ok' && consumption.api !== undefined) {
        budgets.push({ key: 'api', label: t('apiBudget'), budget: consumption.api })
      }
      return h(
        React.Fragment,
        null,
        consumption?.status === 'missing-key' ? h('div', { className: 'mu-notice', role: 'status' }, t('missingKey')) : null,
        consumption?.status === 'invalid-key'
          ? h('div', { className: 'mu-notice mu-notice-error', role: 'alert' }, t('invalidKey', { detail: consumption.message ?? '' }))
          : null,
        consumption?.status === 'unavailable' ? h('div', { className: 'mu-notice', role: 'status' }, t('unavailable')) : null,

        h(
          Card,
          { title: t('accountTitle'), hint: t('accountHint') },
          budgets.length === 0
            ? h('p', { className: 'mu-empty' }, consumption?.status === 'ok' ? t('accountUnavailable') : t('planUnknown'))
            : h(
                'div',
                { className: 'mu-quota-list' },
                budgets.map((entry) =>
                  h(QuotaRow, {
                    key: entry.key,
                    label: entry.label,
                    percent: percentOf(entry.budget),
                    valueText: t('used', { pct: percentOf(entry.budget).toFixed(1) }),
                    hint: `${money(entry.budget.spent, entry.budget.currency ?? consumption.currency)} / ${money(entry.budget.limit, entry.budget.currency ?? consumption.currency)}${entry.budget.resetAt !== undefined ? ` · ${t('resets', { date: resetLabel(entry.budget.resetAt) })}` : ''}`,
                    title: `${t('remaining', { amount: money(Math.max(0, entry.budget.limit - entry.budget.spent), entry.budget.currency ?? consumption.currency) })}`,
                  }),
                ),
                consumption?.status === 'ok'
                  ? h(
                      'div',
                      { className: 'mu-figures' },
                      h('div', { className: 'mu-figure' }, h('span', { className: 'mu-figure-label' }, t('plan')), h('span', { className: 'mu-figure-value' }, consumption.plan ?? t('planUnknown'))),
                      consumption.payg === true
                        ? h('div', { className: 'mu-figure' }, h('span', { className: 'mu-figure-label' }, t('payg')), h('span', { className: 'mu-figure-value' }, '✓'))
                        : null,
                    )
                  : null,
              ),
        ),

        h(
          Card,
          { title: t('harnessTitle'), hint: t('harnessHint') },
          h(
            'div',
            { className: 'mu-figures' },
            h(
              'div',
              { className: 'mu-figure' },
              h('span', { className: 'mu-figure-label' }, t('today')),
              h('span', { className: 'mu-figure-value' }, `${tokens(dayTokens(today))} ${t('tokens')}`),
              h('span', { className: 'mu-figure-sub' }, `${today?.calls ?? 0} ${t('calls')} · ${money(today?.cost ?? 0, 'USD')}`),
            ),
            h(
              'div',
              { className: 'mu-figure' },
              h('span', { className: 'mu-figure-label' }, t('total')),
              h('span', { className: 'mu-figure-value' }, `${tokens(dayTokens(total))} ${t('tokens')}`),
              h('span', { className: 'mu-figure-sub' }, `${total?.calls ?? 0} ${t('calls')} · ${money(total?.cost ?? 0, 'USD')}`),
            ),
            h(
              'div',
              { className: 'mu-figure' },
              h('span', { className: 'mu-figure-label' }, t('estimatedCost')),
              h('span', { className: 'mu-figure-value' }, money(total?.cost ?? 0, 'USD')),
              h('span', { className: 'mu-figure-sub' }, t('inputTokens') + ' / ' + t('outputTokens') + ' / ' + t('cacheTokens')),
            ),
          ),
          h(ModelTable, { rows: today?.byModel ?? [], note: t('estimateNote'), magpie: false }),
        ),

        h(
          Card,
          { title: t('costMeterTitle') },
          h('p', { className: data?.costMeter?.connected === true ? 'mu-note' : 'mu-note mu-note-quiet' }, data?.costMeter?.connected === true ? t('costMeterOn') : t('costMeterOff')),
        ),
      )
    }

    /**
     * The Settings page: every figure, the key, and the cost-meter mirror state.
     */
    function SettingsPage() {
      const snap = useUsage()
      const t = useT()
      const [busy, setBusy] = React.useState(false)
      const [keyDraft, setKeyDraft] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const provider = shownProvider(snap)
      const isMagpie = provider === 'magpie'
      const data = snap.data?.provider === provider ? snap.data : undefined
      const credential = isMagpie ? data?.magpieCredential : data?.credential

      const refresh = async () => {
        if (busy) return
        setBusy(true)
        await load(true)
        setBusy(false)
      }

      const saveKey = async (action) => {
        if (busy) return
        setBusy(true)
        setNotice(null)
        try {
          if (action === 'set') {
            if (keyDraft.trim().length === 0) {
              setNotice({ kind: 'error', text: isMagpie ? t('magpieKeyInput') : t('keyInput') })
              return
            }
            await callBridge('key', { action: 'set', value: keyDraft.trim(), provider })
            setKeyDraft('')
            setNotice({ kind: 'ok', text: t('keySaved') })
          } else {
            await callBridge('key', { action: 'clear', provider })
            setNotice({ kind: 'ok', text: t('keyCleared') })
          }
          await load(true)
        } catch (error) {
          setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'mu-page' },
        h(
          'div',
          { className: 'mu-head' },
          h(
            'div',
            { className: 'mu-head-text' },
            h('h2', { className: 'mu-title' }, t('title')),
            h('p', { className: 'mu-intro' }, t('intro')),
          ),
          h(
            'div',
            { className: 'mu-head-actions' },
            snap.at > 0
              ? h('span', { className: 'mu-updated' }, t('updated', { time: new Date(snap.at).toLocaleTimeString() }))
              : null,
            h('button', { type: 'button', className: 'mu-btn', onClick: refresh, disabled: busy }, busy ? t('refreshing') : t('refresh')),
          ),
        ),
        h(ProviderSwitch, { provider, pick: snap.pick, route: snap.route, onPick: chooseProvider }),
        snap.error !== null && snap.status === 'error'
          ? h(
              'div',
              { className: 'mu-notice mu-notice-error', role: 'alert' },
              t('loadFailed', { detail: snap.error }),
              h('button', { type: 'button', className: 'mu-btn mu-btn-quiet', onClick: refresh }, t('retry')),
            )
          : null,

        data === undefined
          ? h('p', { className: 'mu-empty' }, t('loading'))
          : isMagpie
            ? h(MagpieFigures, { data, snap })
            : h(MistralFigures, { data, snap }),

        h(
          Card,
          {
            title: t('keyTitle'),
            hint: isMagpie
              ? t('magpieKeyHint')
              : fill(t('keyHint'), { ref: credential?.ref ?? 'MISTRAL_API_KEY' }),
          },
          h(
            'div',
            { className: 'mu-key-row' },
            h('span', {
              className: credential?.configured === true || isMagpie ? 'mu-dot mu-dot-on' : 'mu-dot mu-dot-off',
              'aria-hidden': true,
            }),
            h(
              'span',
              { className: 'mu-key-state' },
              credential?.configured === true ? t('keyConfigured') : isMagpie ? t('keyOptional') : t('keyMissing'),
            ),
            credential?.source !== undefined ? h('span', { className: 'mu-key-source' }, t('keySource', { source: credential.source })) : null,
          ),
          h(
            'div',
            { className: 'mu-key-form' },
            h('input', {
              className: 'mu-input',
              type: 'password',
              autoComplete: 'off',
              placeholder: isMagpie ? t('magpieKeyPlaceholder') : t('keyPlaceholder'),
              'aria-label': isMagpie ? t('magpieKeyInput') : t('keyInput'),
              value: keyDraft,
              onChange: (event) => setKeyDraft(event.target.value),
            }),
            h('button', { type: 'button', className: 'mu-btn mu-btn-primary', onClick: () => saveKey('set'), disabled: busy }, t('keySave')),
            credential?.configured === true
              ? h('button', { type: 'button', className: 'mu-btn mu-btn-danger', onClick: () => saveKey('clear'), disabled: busy }, t('keyClear'))
              : null,
          ),
          notice !== null
            ? h('p', { className: notice.kind === 'error' ? 'mu-note mu-note-error' : 'mu-note', role: 'status' }, notice.text)
            : null,
        ),
      )
    }

    /**
     * Localized label for a price source.
     * @param {string | undefined} source - `config`, `catalog`, `published` or `default`.
     * @param {Function} t - translator.
     * @returns {string} display text.
     */
    function priceSourceLabel(source, t) {
      if (source === 'config') return t('priceConfig')
      if (source === 'catalog') return t('priceCatalog')
      if (source === 'published') return t('pricePublished')
      if (source === 'magpie') return t('priceMagpie')
      return t('priceDefault')
    }

    // #endregion

    // #region styles

    const CSS = `
.mu-card{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;min-width:0;margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer;transition:border-color .15s ease,background-color .15s ease}
.mu-card:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
.mu-card:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mu-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.mu-card-title-hit{display:flex;min-width:0;cursor:pointer}
.mu-card-title-hit:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:4px}
.mu-card-title{font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-card-plan{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50%}
.mu-card-bar{height:6px;border-radius:999px;background:var(--dsw-alias-border-l3);overflow:hidden}
.mu-card-fill{height:100%;border-radius:999px;background:${MISTRAL_GRADIENT};transition:width .45s ease}
.mu-card-fill-magpie{background:${MAGPIE_GRADIENT}}
.mu-card-lines{display:flex;flex-direction:column;gap:2px;min-width:0}
.mu-line{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.mu-line-label{color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-line-value{font-variant-numeric:tabular-nums;white-space:nowrap}
.mu-line-quiet .mu-line-label,.mu-line-quiet .mu-line-value{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.mu-line-error{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;display:block}
.mu-switch{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.mu-switch-compact{gap:4px}
.mu-switch-seg{box-sizing:border-box;height:22px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:20px;cursor:pointer;white-space:nowrap}
.mu-switch-compact .mu-switch-seg{height:20px;padding:0 8px;font-size:11px;line-height:18px}
.mu-switch-seg:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.mu-switch-seg:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mu-switch-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse, #fff)}
.mu-switch-on:hover{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse, #fff)}
.mu-switch-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.mu-rail{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;width:40px;height:40px;margin:0 auto;border-radius:10px;color:var(--dsw-alias-label-secondary)}
.mu-clickable{cursor:pointer;transition:border-color .15s ease,background-color .15s ease}
.mu-clickable:active{transform:scale(.995)}
.mu-clickable:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mu-rail.mu-clickable:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
@keyframes mu-refresh-pulse{0%,to{opacity:.55}50%{opacity:1}}
.mu-busy{animation:mu-refresh-pulse 1.1s ease-in-out 2;cursor:progress}
.mu-rail .mu-ring-fill{transition:stroke-dasharray .45s ease}
.mu-rail-value{font-size:9px;line-height:10px;font-variant-numeric:tabular-nums}
.mu-page{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;max-width:760px;color:var(--dsw-alias-label-primary)}
.mu-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.mu-head-text{display:flex;flex-direction:column;gap:4px;min-width:0}
.mu-title{margin:0;font-size:16px;line-height:24px;font-weight:600}
.mu-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.mu-head-actions{display:flex;align-items:center;gap:10px;flex:none}
.mu-updated{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mu-btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;line-height:18px;cursor:pointer;white-space:nowrap}
.mu-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.mu-btn:disabled{opacity:.45;cursor:default}
.mu-btn-quiet{border-color:transparent}
.mu-btn-primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse, #fff)}
.mu-btn-danger{color:var(--dsw-alias-state-error-primary)}
.mu-notice{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.mu-notice-error{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary)}
.mu-section-card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.mu-section-card-head{display:flex;flex-direction:column;gap:2px}
.mu-section-card-title{margin:0;font-size:14px;line-height:22px;font-weight:600}
.mu-section-card-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mu-quota-list{display:flex;flex-direction:column;gap:14px}
.mu-sub-quota{display:flex;flex-direction:column;gap:8px}
.mu-sub-head{display:flex;align-items:baseline;gap:8px}
.mu-sub-name{font-size:13px;line-height:18px;font-weight:600}
.mu-badge{font-size:9px;line-height:12px;color:var(--dsw-alias-state-success-primary)}
.mu-periods{display:flex;flex-wrap:wrap;gap:6px}
.mu-period{box-sizing:border-box;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:24px;cursor:pointer;white-space:nowrap}
.mu-period:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.mu-period:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mu-period-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse, #fff)}
.mu-period-on:hover{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse, #fff)}
.mu-row{display:grid;grid-template-columns:88px 1fr auto;align-items:center;gap:10px;min-width:0}
.mu-row-label{font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-row-bar{height:8px;border-radius:999px;background:var(--dsw-alias-border-l3);overflow:hidden}
.mu-row-fill{height:100%;border-radius:999px;background:${MISTRAL_GRADIENT};transition:width .45s ease}
.mu-row-fill-magpie{background:${MAGPIE_GRADIENT}}
.mu-row-value{font-size:13px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.mu-row-hint{grid-column:2 / -1;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mu-figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.mu-figure{display:flex;flex-direction:column;gap:2px;min-width:0}
.mu-figure-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.mu-figure-value{font-size:15px;line-height:22px;font-weight:500;font-variant-numeric:tabular-nums}
.mu-figure-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mu-subtitle{margin:0 0 6px;font-size:13px;line-height:20px;font-weight:600}
.mu-table-wrap{min-width:0;overflow-x:auto}
.mu-table{width:100%;border-collapse:collapse;font-size:12px;line-height:18px}
.mu-table th{text-align:left;font-weight:400;color:var(--dsw-alias-label-tertiary);padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.mu-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-variant-numeric:tabular-nums}
.mu-table tr:last-child td{border-bottom:none}
.mu-num{text-align:right;white-space:nowrap}
.mu-mono{font-family:var(--ds-font-family-code, ui-monospace, monospace);overflow-wrap:anywhere}
.mu-empty{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.mu-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mu-note-quiet{color:var(--dsw-alias-label-tertiary)}
.mu-note-error{color:var(--dsw-alias-state-error-primary)}
.mu-key-row{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px}
.mu-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}
.mu-dot-on{background:var(--dsw-alias-state-success-primary)}
.mu-dot-off{background:var(--dsw-alias-state-error-primary)}
.mu-key-state{font-weight:500}
.mu-key-source{color:var(--dsw-alias-label-tertiary);font-size:12px}
.mu-key-form{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.mu-input{box-sizing:border-box;flex:1 1 220px;min-width:160px;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px}
.mu-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
`

    /**
     * Install the stylesheet once per page, and remove it on dispose.
     * @returns {() => void} disposer.
     */
    function installStyles() {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-mistral-usage'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    // #endregion

    // #region locale

    /**
     * Bind a translator to the shared snapshot's language, so a component
     * re-renders with fresh copy when the locale changes.
     * @returns {(key: string, params?: Record<string, string>) => string} translator.
     */
    function useT() {
      const language = useUsage().language
      return React.useCallback(
        (key, params) => {
          const table = language === 'zh' ? zh : en
          const template = table[key] ?? en[key] ?? key
          return params === undefined ? template : fill(template, params)
        },
        [language],
      )
    }

    // #endregion

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)

        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, { en, zh })
          } catch (error) {
            console.warn('mistral-usage: dictionaries already registered', error)
            return () => {}
          }
        }, 'mistral-usage: dictionaries')

        ctx.effect(() => installStyles(), 'mistral-usage: styles')

        // Follow the session on screen, so the card reports the route of the
        // conversation the user is looking at. The sessions service is
        // optional: without it the Host falls back to the last route it saw.
        ctx.effect(() => {
          const sessions = ctx.get?.('sessions')
          const list = sessions?.list
          if (list === undefined || typeof list.getSnapshot !== 'function') return () => {}
          const sync = () => {
            try {
              const snapshot = list.getSnapshot()
              const id = snapshot?.activeSessionId ?? snapshot?.active ?? snapshot?.sessionId
              const next = typeof id === 'string' && id.length > 0 ? id : null
              if (next !== activeSessionId) {
                activeSessionId = next
                // A new session may be on another route, so re-read at once.
                load(false)
              }
            } catch {
              /* the list is mid-reload; the next change syncs it */
            }
          }
          sync()
          const off = typeof list.subscribe === 'function' ? list.subscribe(sync) : undefined
          return () => {
            if (typeof off === 'function') off()
          }
        }, 'mistral-usage: active session')

        // One poll feeds both surfaces; it starts with the plugin and stops with it.
        ctx.effect(() => {
          let alive = true
          const tick = () => {
            if (!alive) return
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            load(false)
          }
          load(false)
          const timer = setInterval(tick, REFRESH_MS)
          const onVisible = () => {
            if (document.visibilityState === 'visible') load(false)
          }
          document.addEventListener('visibilitychange', onVisible)
          return () => {
            alive = false
            clearInterval(timer)
            document.removeEventListener('visibilitychange', onVisible)
          }
        }, 'mistral-usage: poll')

        // Keep the shared snapshot's language in step with the Harness locale.
        ctx.effect(() => {
          const sync = () => {
            let active = 'en'
            try {
              active = ctx.locale.getSnapshot?.().active ?? 'en'
            } catch {
              active = 'en'
            }
            const snap = usageStore.getSnapshot()
            if (snap.language !== active) usageStore.set({ ...snap, language: active })
          }
          sync()
          const off = ctx.locale.subscribe?.(sync)
          return () => {
            if (typeof off === 'function') off()
          }
        }, 'mistral-usage: locale sync')

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.footer.action', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.footer.action',
                  id: 'mistral-usage',
                  order: FOOTER_ORDER,
                  label: () => t('nav'),
                  inject: () => ({ t }),
                },
                SidebarUsageCard,
              ),
            ),
          'mistral-usage: sidebar card',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: SETTINGS_ID,
                  order: SETTINGS_ORDER,
                  label: () => t('nav'),
                  inject: () => ({ t }),
                },
                SettingsPage,
              ),
            ),
          'mistral-usage: settings page',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section.icon', () =>
              ctx.slots.register({ name: 'settings.section.icon', id: SETTINGS_ID }, UsageGlyph),
            ),
          'mistral-usage: settings icon',
        )
      },
    }
  },
})
