# DSH local build plugins

Each subdirectory is one self-contained local plugin bundle (`@local/*`) for
DeepSeek Harness. The Plugin Manager installs a bundle by adding a `link:`
dependency to the active profile, so the profile's `node_modules/@local/<name>`
is a symlink back into this repository — editing here changes the installed
plugin.

| Directory | Package | What it does |
| --- | --- | --- |
| `dsh-prompt-library` | `@local/dsh-prompt-library` | A tab in the right Sidebar that keeps frequently used prompts: pick one into the composer, edit each prompt's title, text and tags, filter the list by tag or search, and press and hold a card to reorder it. A blank conversation also gets a prompt button on its New Session row (beside the workspace and preset controls) that inserts a saved prompt by title, and Settings → 常用提示词 maintains the same list. Picking another prompt while the composer still holds an untouched insertion swaps the previous prompt in place instead of appending. |
| `dsh-local-build-plugins` | `@local/dsh-local-build-plugins` | Groups locally built plugins into their own section in Plugin Manager. |
| `dsh-local-build-plugins-tab` | `@local/dsh-local-build-plugins-tab` | Adds the "Local build" tab to Plugin Manager. |
| `dsh-turn-notify` | `@local/dsh-turn-notify` | Notifies when a turn finishes. |

## Shape of one bundle

```
<name>/
  package.json          # name, exports, dsh.bundle.patch + dsh.client
  cordis.patch.yml      # the loader rows this bundle inserts
  index.js              # Host half (may be a no-op)
  client.js             # Browser half, when the bundle has UI
  locale/{en,zh}.json   # display metadata Plugin Manager reads
  icon.svg              # exported artwork
```

## Install / update

Install through Plugin Manager (never by hand-editing the profile):

- Web UI: **Plugins → Install**, then pick the bundle directory.
- After changing `client.js`, refresh the page; after changing Host code,
  restart the app.

## Rules

- One directory per bundle; the directory name is the package name without the
  `@local/` scope.
- `node_modules/`, build output, and logs stay out of the repository.
- Bump `package.json` `version` when a change is worth a new installed version.
