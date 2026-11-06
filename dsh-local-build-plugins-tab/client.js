/**
 * Browser half of the local build plugins tab component.
 *
 * The tab itself is a supported contribution: this package registers one
 * `plugins.tab` entry after the shipped Installed tab and the Discover tab, and
 * the tab lists the locally built bundles. Every row carries its own switch
 * (backed by `pluginManager.setBundleEnabled`) and the tab also offers one
 * button that disables every other local build in a single click.
 *
 * The bundle that ships this component (`@local/dsh-local-build-plugins`)
 * inserts this package as its own component row, so this bundle patch stays
 * empty; its Client half still attaches to that row, which is what makes the
 * two components independently switchable on the bundle's page.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-local-build-plugins-tab',
  factory: (require) => {
    const React = require('react')

    /** Locale namespace this component owns. */
    const NS = 'localBuildPluginsTab'
    /** Activation dependencies: order this half after the page's owner and page. */
    const inject = ['slots', 'locale', 'remote', 'remote.pluginManager']

    /** The tab this component contributes. */
    const TAB_ID = 'local-builds'
    const TAB_ORDER = 10
    /** The bundle this component belongs to; its row is shown as "this plugin". */
    const OWN_PACKAGE = '@local/dsh-local-build-plugins'
    /** This component's own package, never listed as a plugin of its own. */
    const SELF_PACKAGE = '@local/dsh-local-build-plugins-tab'

    /** A dependency spec that names a directory on this machine, possibly behind `name@`. */
    const LOCAL_SPEC = /(?:^|@)(?:link|file|portal|workspace):/i
    /** A dependency spec that is a filesystem path, possibly behind `name@`. */
    const LOCAL_PATH = /(?:^|@)(?:~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/])/
    /** Scope conventionally used by locally built packages. */
    const LOCAL_SCOPE = '@local/'

    const zh = {
      tabLabel: '本地构建插件',
      description: '这些插件从本地目录构建安装。关闭后不会卸载，可随时在「已安装」中重新打开。',
      actionDisable: '关闭其他本地构建插件',
      actionDisableCount: '关闭其他本地构建插件（{count}）',
      ownTag: '本插件',
      empty: '还没有本地构建的插件。',
      loading: '正在读取插件…',
      loadError: '无法读取插件列表。',
      disabling: '正在关闭…',
      done: '已关闭 {count} 个插件。',
      partial: '已关闭 {count} 个插件，{failed} 个未能关闭。',
      toggleFailed: '无法切换 {name}。',
      enableRow: '启用 {name}',
      disableRow: '停用 {name}',
      retry: '重试',
      versionLabel: 'v{version}',
    }
    const en = {
      tabLabel: 'Local build plugins',
      description: 'These plugins are built and installed from local directories. Disabling one does not uninstall it; turn it on again from Installed.',
      actionDisable: 'Disable other local builds',
      actionDisableCount: 'Disable other local builds ({count})',
      ownTag: 'This plugin',
      empty: 'No locally built plugins yet.',
      loading: 'Reading plugins…',
      loadError: 'Could not read the plugin list.',
      disabling: 'Disabling…',
      done: 'Disabled {count} plugins.',
      partial: 'Disabled {count} plugins; {failed} could not be disabled.',
      toggleFailed: 'Could not switch {name}.',
      enableRow: 'Enable {name}',
      disableRow: 'Disable {name}',
      retry: 'Retry',
      versionLabel: 'v{version}',
    }

    const dictionaries = { zh, en, ja: en, es: en, fr: en, de: en, ru: en, pt: en }

    const ROW_STYLE = {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 12px',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 10,
      background: 'var(--dsw-alias-bg-layer-1)',
    }
    const NAME_STYLE = {
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 13,
      fontWeight: 600,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    const META_STYLE = {
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 12,
      whiteSpace: 'nowrap',
    }
    const TAG_STYLE = {
      color: 'var(--dsw-alias-label-secondary)',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 999,
      padding: '1px 7px',
      fontSize: 11,
      whiteSpace: 'nowrap',
    }
    const BUTTON_STYLE = {
      alignSelf: 'flex-start',
      appearance: 'none',
      border: 'none',
      borderRadius: 8,
      padding: '7px 14px',
      fontSize: 13,
      fontWeight: 600,
      color: '#fff',
      background: 'var(--dsw-alias-brand-primary)',
      cursor: 'pointer',
    }
    const SECONDARY_BUTTON_STYLE = {
      ...BUTTON_STYLE,
      color: 'var(--dsw-alias-label-primary)',
      background: 'transparent',
      border: '1px solid var(--dsw-alias-border-l2)',
    }
    const NOTICE_STYLE = {
      margin: 0,
      fontSize: 12,
      color: 'var(--dsw-alias-label-secondary)',
    }
    const TRACK_STYLE = {
      width: 34,
      height: 20,
      flex: 'none',
      borderRadius: 999,
      border: 'none',
      padding: 2,
      display: 'inline-flex',
      alignItems: 'center',
      boxSizing: 'border-box',
      transition: 'background 120ms ease',
    }
    const KNOB_STYLE = {
      width: 16,
      height: 16,
      borderRadius: '50%',
      background: '#fff',
      display: 'block',
      transition: 'transform 120ms ease',
    }

    /**
     * One row's switch: an accessible toggle button with the host's accent color.
     * @param props - checked state, disabled state, accessible name, and handler.
     */
    function RowSwitch({ checked, disabled, label, onChange }) {
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
        style: {
          ...TRACK_STYLE,
          background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-idle-primary)',
          opacity: disabled ? 0.55 : 1,
          cursor: disabled ? 'default' : 'pointer',
          justifyContent: checked ? 'flex-end' : 'flex-start',
        },
      }, React.createElement('span', { style: KNOB_STYLE }))
    }

    /**
     * Build the tab component for one plugin context.
     * @param ctx - the browser plugin context.
     * @returns the tab component.
     */
    function createTabComponent(ctx) {
      const remote = ctx.remote.pluginManager
      const resolveText = (text) => (typeof ctx.locale.resolveText === 'function' ? ctx.locale.resolveText(text) : String(text))
      const isLocalBuild = (pkg) => {
        if (pkg === null || typeof pkg !== 'object') return false
        const target = pkg.installTarget
        for (const spec of [pkg.source, target === undefined ? undefined : target.spec]) {
          if (typeof spec !== 'string' || spec === '') continue
          if (LOCAL_SPEC.test(spec) || LOCAL_PATH.test(spec)) return true
        }
        return typeof pkg.name === 'string' && pkg.name.startsWith(LOCAL_SCOPE)
      }

      /** @param props - the tab slot props, including the locale `t`. */
      return function LocalBuildPluginsTab(props) {
        const t = typeof props.t === 'function' ? props.t : (key) => key
        const [state, setState] = React.useState({ status: 'loading', packages: [], error: null })
        const [busyName, setBusyName] = React.useState(null)
        const [report, setReport] = React.useState(null)

        const load = React.useCallback(async () => {
          setState((previous) => ({ ...previous, error: null }))
          try {
            const result = await remote.listBundles()
            if (result === null || typeof result !== 'object' || result.ok !== true) throw new Error('listBundles failed')
            const packages = result.value
              .filter((pkg) => pkg.installed === true
                && pkg.official !== true
                && pkg.name !== SELF_PACKAGE
                && isLocalBuild(pkg))
              .sort((a, b) => String(a.name).localeCompare(String(b.name)))
            setState({ status: 'ready', packages, error: null })
          } catch (error) {
            setState({ status: 'error', packages: [], error: String(error && error.message ? error.message : error) })
          }
        }, [])

        React.useEffect(() => {
          load()
        }, [load])

        const title = (pkg) => (pkg.meta && pkg.meta.title !== undefined ? resolveText(pkg.meta.title) : pkg.name) || pkg.name
        const toggle = async (pkg, enabled) => {
          if (busyName !== null) return
          setBusyName(pkg.name)
          setReport(null)
          try {
            const result = await remote.setBundleEnabled(pkg.name, enabled)
            if (result === null || typeof result !== 'object' || result.ok !== true) setReport({ kind: 'failed', name: title(pkg) })
          } catch (error) {
            setReport({ kind: 'failed', name: title(pkg) })
          }
          await load()
          setBusyName(null)
        }

        const others = state.packages.filter((pkg) => pkg.name !== OWN_PACKAGE)
        const targets = others.filter((pkg) => pkg.enabled === true)
        const bulkBusy = busyName !== null

        const disableOthers = async () => {
          if (bulkBusy || targets.length === 0) return
          setBusyName('__all__')
          setReport(null)
          let done = 0
          let failed = 0
          for (const pkg of targets) {
            try {
              const result = await remote.setBundleEnabled(pkg.name, false)
              if (result !== null && typeof result === 'object' && result.ok === true) done += 1
              else failed += 1
            } catch (error) {
              failed += 1
            }
          }
          await load()
          setBusyName(null)
          setReport(failed === 0 ? { kind: 'done', count: done } : { kind: 'partial', count: done, failed })
        }

        const rows = state.packages.map((pkg) => {
          const own = pkg.name === OWN_PACKAGE
          return React.createElement('li', { key: pkg.name, style: ROW_STYLE },
            React.createElement('div', {
              style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 },
            },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
              React.createElement('span', { style: NAME_STYLE, title: pkg.name }, title(pkg)),
              own ? React.createElement('span', { style: TAG_STYLE }, t('ownTag')) : null,
              React.createElement('span', { style: META_STYLE }, t('versionLabel', { version: pkg.version || '?' }))),
            React.createElement('span', { style: { ...META_STYLE, overflow: 'hidden', textOverflow: 'ellipsis' } }, pkg.name)),
            own
              ? null
              : React.createElement(RowSwitch, {
                checked: pkg.enabled === true,
                disabled: bulkBusy && busyName !== pkg.name,
                label: t(pkg.enabled === true ? 'disableRow' : 'enableRow', { name: title(pkg) }),
                onChange: (enabled) => toggle(pkg, enabled),
              }))
        })

        const actionLabel = busyName === '__all__'
          ? t('disabling')
          : targets.length > 0 ? t('actionDisableCount', { count: targets.length }) : t('actionDisable')

        const notice = report === null
          ? null
          : report.kind === 'failed'
            ? t('toggleFailed', { name: report.name })
            : t(report.kind === 'done' ? 'done' : 'partial', report)

        return React.createElement('div', {
          style: { display: 'flex', flexDirection: 'column', gap: 12 },
        },
        React.createElement('p', {
          style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 },
        }, t('description')),
        state.status === 'loading'
          ? React.createElement('p', { style: NOTICE_STYLE, role: 'status' }, t('loading'))
          : state.status === 'error'
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
              React.createElement('p', { style: { ...NOTICE_STYLE, color: 'var(--dsw-alias-state-error-primary)' }, role: 'alert' }, t('loadError')),
              React.createElement('button', { type: 'button', style: SECONDARY_BUTTON_STYLE, onClick: load }, t('retry')))
            : state.packages.length === 0
              ? React.createElement('p', { style: NOTICE_STYLE }, t('empty'))
              : React.createElement(React.Fragment, null,
                React.createElement('ul', {
                  style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
                }, rows),
                React.createElement('button', {
                  type: 'button',
                  style: {
                    ...BUTTON_STYLE,
                    opacity: bulkBusy || targets.length === 0 ? 0.55 : 1,
                    cursor: bulkBusy || targets.length === 0 ? 'default' : 'pointer',
                  },
                  disabled: bulkBusy || targets.length === 0,
                  onClick: disableOthers,
                }, actionLabel),
                notice === null ? null : React.createElement('p', { style: NOTICE_STYLE, role: 'status' }, notice)))
      }
    }

    /**
     * Contribute the Local build plugins tab.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'local-build-plugins-tab: dictionaries')
      const label = () => ctx.locale.bind(NS)('tabLabel')
      const Tab = createTabComponent(ctx)
      ctx.effect(() => ctx.slots.inject('plugins.tab', () => ctx.slots.register({
        name: 'plugins.tab',
        id: TAB_ID,
        order: TAB_ORDER,
        label,
        locale: NS,
      }, Tab)), 'local-build-plugins-tab: plugins page tab')
    }

    return { inject, apply }
  },
})
