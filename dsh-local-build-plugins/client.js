/**
 * Browser half of the local build plugins bundle's group component.
 *
 * The shipped Plugins page renders three groups on its Installed tab and has no
 * slot for a fourth. A second `main`/`plugins` registration cannot redeclare the
 * child slots the page renders through, so this module leaves the registration
 * alone and swaps only its component: it captures the page component from the
 * live slot entry, installs a wrapper, and the wrapper renders the page and
 * moves the local builds' cards into a group cloned from the installed group's
 * markup. The entry keeps its `children`, `inject`, `store`, and locale
 * options, so every slot the page feeds still works.
 *
 * The tab is a separate component package (`@local/dsh-local-build-plugins-tab`)
 * with its own Client half, so the bundle's two rows can be switched
 * independently. This half also drops the tab package's own bundle card from the
 * page, because the tab is mounted as a component row of this bundle instead.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-local-build-plugins',
  factory: (require) => {
    const React = require('react')

    /** Locale namespace this component owns. */
    const NS = 'localBuildPlugins'
    /** Activation dependencies: order this half after the page's owner and page. */
    const inject = ['slots', 'locale']

    /** Attribute the page puts on each group section; the installed group's id. */
    const GROUP_ATTR = 'data-plugin-group'
    const INSTALLED_GROUP = 'bundles'
    /** Id of the group this component adds. */
    const LOCAL_GROUP = 'local-builds'
    /** The page's main-panel key. */
    const PANEL_KEY = 'plugins'
    /** Component packages that this bundle mounts as rows; their own bundle cards stay hidden. */
    const HIDDEN_PACKAGES = new Set(['@local/dsh-local-build-plugins-tab'])
    /** Marks a wrapper this component installed on a page entry. */
    const PATCHED = Symbol('localBuildPlugins.patched')

    /** A dependency spec that names a directory on this machine, possibly behind `name@`. */
    const LOCAL_SPEC = /(?:^|@)(?:link|file|portal|workspace):/i
    /** A dependency spec that is a filesystem path, possibly behind `name@`. */
    const LOCAL_PATH = /(?:^|@)(?:~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/])/
    /** Scope conventionally used by locally built packages. */
    const LOCAL_SCOPE = '@local/'

    /** Simplified Chinese dictionary and key source of truth. */
    const zh = {
      heading: '本地构建插件',
    }
    const en = {
      heading: 'Local build plugins',
    }
    const ja = {
      heading: 'ローカルビルドプラグイン',
    }
    const es = {
      heading: 'Complementos de compilación local',
    }
    const fr = {
      heading: 'Extensions compilées localement',
    }
    const de = {
      heading: 'Lokal erstellte Plugins',
    }
    const ru = {
      heading: 'Локально собранные плагины',
    }
    const pt = {
      heading: 'Plug-ins compilados localmente',
    }

    const dictionaries = { zh, en, ja, es, fr, de, ru, pt }

    const isElement = (value) => React.isValidElement(value)
    /** Host elements and the page's own fragments are the tree this module walks. */
    const isHostElement = (value) => isElement(value)
      && (typeof value.type === 'string' || value.type === React.Fragment)

    /**
     * Read an element's children as a keyed array without throwing on a single
     * child, text, null, or an absent `children` prop.
     */
    function childrenOf(element) {
      if (!isElement(element)) return []
      return React.Children.toArray(element.props.children)
    }

    /**
     * Whether an installed package is a local build: its dependency spec names a
     * local directory, or it uses the conventional local scope. The Host returns
     * `link:`/`file:` specs as-is and aliases them as `<name>@link:…`, so the
     * match allows a `@` boundary.
     */
    function isLocalBuild(pkg) {
      if (pkg === null || typeof pkg !== 'object') return false
      const target = pkg.installTarget
      const specs = [pkg.source, target === undefined ? undefined : target.spec]
      for (const spec of specs) {
        if (typeof spec !== 'string' || spec === '') continue
        if (LOCAL_SPEC.test(spec) || LOCAL_PATH.test(spec)) return true
      }
      return typeof pkg.name === 'string' && pkg.name.startsWith(LOCAL_SCOPE)
    }

    /**
     * Split the installed group's cards into hidden internal packages, local
     * builds, and everything else.
     * @returns the group's parts and the moved cards, or null to leave it alone.
     */
    function splitInstalledGroup(section) {
      const children = childrenOf(section)
      const list = children.find((child) => isElement(child) && child.type === 'ul')
      if (!isElement(list)) return null
      const kept = []
      const moved = []
      let hidden = false
      for (const card of childrenOf(list)) {
        const pkg = isElement(card) ? card.props.pkg : undefined
        if (pkg === undefined) {
          kept.push(card)
          continue
        }
        if (HIDDEN_PACKAGES.has(pkg.name)) {
          hidden = true
          continue
        }
        if (isLocalBuild(pkg)) moved.push(card)
        else kept.push(card)
      }
      if (moved.length === 0 && !hidden) return null
      return { siblings: children.filter((child) => child !== list), list, kept, moved }
    }

    /** Rebuild the installed group without the local builds; an emptied group is dropped. */
    function keepInstalledGroup(section, split) {
      if (split.kept.length === 0) return null
      return React.cloneElement(section, undefined, ...split.siblings,
        React.cloneElement(split.list, undefined, ...split.kept))
    }

    /**
     * Clone the installed group's markup as the local-build group: the same card
     * list and header styling, a new heading and group id, and the moved cards.
     */
    function buildLocalGroup(section, split, heading) {
      const head = split.siblings[0]
      const rest = split.siblings.slice(1)
      const headChildren = childrenOf(head)
      const title = headChildren[0]
      const newHead = isElement(head) ? React.cloneElement(head, undefined,
        isElement(title) ? React.cloneElement(title, undefined, heading) : heading,
        ...headChildren.slice(1)) : heading
      return React.cloneElement(section, {
        key: LOCAL_GROUP,
        [GROUP_ATTR]: LOCAL_GROUP,
      }, newHead, ...rest,
      React.cloneElement(split.list, { key: `${LOCAL_GROUP}-list` }, ...split.moved))
    }

    /**
     * Walk the page's element tree and move the local-build cards into a new
     * group directly below the installed group.
     */
    function decorateTree(tree, heading) {
      if (!isElement(tree)) return tree
      let decorated = false
      const visit = (node) => {
        if (!isHostElement(node)) return node
        const children = childrenOf(node)
        if (children.length === 0) return node
        const next = []
        for (const child of children) {
          if (!decorated && isElement(child) && child.props[GROUP_ATTR] === INSTALLED_GROUP) {
            const split = splitInstalledGroup(child)
            if (split !== null) {
              decorated = true
              const installed = keepInstalledGroup(child, split)
              if (installed !== null) next.push(installed)
              if (split.moved.length > 0) next.push(buildLocalGroup(child, split, heading))
              continue
            }
          }
          next.push(visit(child))
        }
        return React.cloneElement(node, undefined, ...next)
      }
      return visit(tree)
    }

    /**
     * Contribute the local-build group by wrapping the shipped page component on
     * its own live `main`/`plugins` entry.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'local-build-plugins: dictionaries')
      const heading = () => ctx.locale.bind(NS)('heading')

      /** The page entry this component wrapped, if any. */
      let patched = null
      let warned = false
      let bumpSeed = 0

      /** Render the shipped page, then move its local-build cards into the new group. */
      function createWrapper(original) {
        function LocalBuildPluginsPage(props) {
          const tree = original(props)
          if (!isElement(tree)) return tree
          try {
            return decorateTree(tree, heading())
          } catch (error) {
            if (!warned) {
              warned = true
              console.warn('local-build-plugins: could not regroup the installed plugins', error)
            }
            return tree
          }
        }
        LocalBuildPluginsPage[PATCHED] = original
        return LocalBuildPluginsPage
      }

      /**
       * Ask the open page to render again after its entry's component changed.
       * Slot versions move only on registrations, so a probe cell is registered
       * and released in one tick.
       */
      function refresh() {
        try {
          bumpSeed += 1
          const dispose = ctx.slots.register({ name: 'main', key: `__local_build_plugins_${bumpSeed}` }, () => null)
          dispose()
        } catch (error) {
          /* the page rerenders on its next slot change anyway */
        }
      }

      /** The shipped page's live `main`/`plugins` registration, if it exists. */
      const findPageEntry = () => ctx.slots.entries('main').find((entry) => entry.options.key === PANEL_KEY
        && typeof entry.component === 'function'
        && entry.component[PATCHED] === undefined
        && entry.children !== undefined)

      /** Whether this component's wrapper is still installed on the entry it wrapped. */
      const stillPatched = () => patched !== null && patched.entry.component === patched.wrapper

      /** Put the original component back on the entry this component wrapped. */
      function restore() {
        if (patched === null) return
        const { entry, original, wrapper } = patched
        patched = null
        if (entry.component === wrapper) {
          entry.component = original
          refresh()
        }
      }

      /** Wrap the shipped page entry once it is registered, and re-wrap after a re-registration. */
      function sync() {
        const entry = findPageEntry()
        if (entry === undefined) {
          if (stillPatched()) return
          patched = null
          return
        }
        if (patched !== null && patched.entry === entry && stillPatched()) return
        const original = entry.component
        const wrapper = createWrapper(original)
        entry.component = wrapper
        patched = { entry, original, wrapper }
        refresh()
      }

      ctx.effect(() => ctx.slots.inject('main', () => {
        const off = ctx.slots.subscribe('main', sync)
        sync()
        return () => {
          off()
          restore()
        }
      }), 'local-build-plugins: plugins page group')
    }

    return { inject, apply }
  },
})
