# @local/dsh-local-build-plugins

A two-component bundle for plugins that are built and installed from local
directories:

| Component | What it does |
| --- | --- |
| **Local build plugins** (this package) | Moves locally built plugins out of the **Installed plugins** group into their own **Local build plugins** group directly below it. |
| **Local build plugins tab** (`@local/dsh-local-build-plugins-tab`) | Adds a tab after **Installed** and **Discover** that lists locally built bundles, each with its own switch, plus one button that disables every other local build. |

Both components are separate rows in this bundle's patch, each with its own
Client half, so they can be switched on and off independently from the bundle's
page in the plugin manager.

## How it works

The shipped Plugins page renders three groups on its Installed tab and has no
slot for a fourth. A second `main`/`plugins` registration cannot redeclare the
child slots the page renders through (the slot core rejects a redeclared child
and hands `renderSlot` only to the entry that declares them). So the group
component leaves the shipped registration alone and swaps only its component: it
captures the page component from the live slot entry, installs a wrapper, and
the wrapper renders the page and moves the local builds' cards into a group
cloned from the installed group's markup. The entry keeps its `children`,
`inject`, `store`, and locale options, so every extension slot the page feeds
keeps working.

The tab component uses the supported `plugins.tab` slot and the
`pluginManager` Remote; it does not touch page internals.

A package counts as a local build when its dependency spec names a local
directory (`link:`, `file:`, `portal:`, `workspace:`, or a path, including the
Host's aliased `name@link:…` form), or when its name uses the conventional
`@local/` scope.

The original page component is restored when the group component unloads. If the
shipped registration is absent, its component is not a plain function, or the
installed group cannot be found, the page renders exactly as before; a
decoration failure is logged once and falls back to the undecorated page.

## Install order

The tab component package is a dependency that must be installed before this
bundle, so its row resolves:

```sh
dsh plugin --profile <profile> add /path/to/dsh-local-build-plugins-tab
dsh plugin --profile <profile> add /path/to/dsh-local-build-plugins
```

The tab component's own bundle patch is empty; it is mounted as this bundle's
second row, and its bundle card is hidden by the group component.
