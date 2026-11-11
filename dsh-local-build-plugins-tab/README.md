# @local/dsh-local-build-plugins-tab

The **Local build plugins** tab component of the Local build plugins bundle.

It registers one `plugins.tab` entry after the shipped **Installed** tab and the
**Discover** tab. The tab lists the locally built bundles with a switch on every
row (backed by `pluginManager.setBundleEnabled`) and one bulk button that flips
every other local build at once: while any of them is on it disables them all,
and once every one of them is off it turns them all back on. It never lists
itself or the bundle that owns it as separate entries.

This package carries its own Client half so the bundle can mount it as an
independent component row: the bundle's patch inserts
`@local/dsh-local-build-plugins-tab` as a row, and this package's own bundle
patch is intentionally empty — that row is the only place the component is
mounted, and switching it off removes the tab without touching the bundle's
other component.

## Files

| File | Purpose |
| --- | --- |
| `cordis.patch.yml` | Empty on purpose; the bundle mounts this component as its row. |
| `index.js` | Host half: no-op; the Client half owns the tab. |
| `client.js` | Client half: registers the tab, its rows, and their switches. |
| `locale/*.json` | Component title and description for the bundle's component list. |
| `icon.svg` | Component icon. |
