# Turn result notifications

A DeepSeek Harness plugin that uses macOS Notification Center for the two moments a
conversation needs your attention while you are looking elsewhere:

- **A reply finished** — every `turn/end` produces a banner with the conversation
  name and a preview of the reply.
- **An approval is pending** — every `approval/asked` produces a banner with the
  tool name and the reason, so a waiting approval never stalls unnoticed.

Clicking a banner brings DSH forward and opens the conversation that produced it.
The banner carries the DeepSeek Harness app icon and name because it is raised by
the page's own Web Notification API — not by a shell script.

Both alerts are **on by default** and can be switched off individually on the
**Settings → 会话结果弹窗 / Turn result notifications** page, which also shows the
system permission state, a "Allow notifications" button, a test button and the
sound switch. Settings apply immediately (no restart) and are persisted.

## How it works

| Half | File | Responsibility |
| --- | --- | --- |
| Host | `index.js` | Follows `session/event` (`turn/end`, `approval/asked`, `session/title`, `assistant/message`), queues one notice per event, serves `GET /dsh-turn-notify/pending?after=<seq>` and `GET/POST /dsh-turn-notify/settings`, persists the switches. |
| Client | `client.js` | Polls the queue every 1.5 s and raises each notice with `new Notification(...)`; a click focuses the window and calls `uiWorkspace.openSession(target)`. Also registers the Settings page and its nav icon. |
| Manifest | `package.json`, `cordis.patch.yml` | Bundle row `turn-notify` with defaults for every knob. |

Child-agent (`origin: 'subagent'`) sessions stay quiet unless `includeSubagents: true`.
Approval notices are de-duplicated by approval id.

The switches are stored in `$DSH_HOME/turn-notify/settings.json` (default
`~/.dsh/turn-notify/settings.json`) so they survive restarts and reinstalls.

### Why not `osascript`?

An `osascript` banner is delivered by "Script Editor": it shows no DSH icon, no
click action, and clicking it opens the Script Editor. The renderer API is the
only way to get the app identity and the click-to-conversation behaviour, so it is
the default. The CLI banner survives only as an opt-in fallback for the case where
no page is open at all (`fallback: true`), where it is attributed to Script Editor
by macOS.

## Configuration (bundle row `turn-notify`)

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch for the whole plugin. |
| `turnEnd` | `true` | Default for the "reply finished" switch (a stored value wins). |
| `approval` | `true` | Default for the "approval needed" switch (a stored value wins). |
| `sound` | `true` | Default for the sound switch. |
| `fallback` | `false` | Opt-in `osascript` banner when no page is polling. |
| `soundName` | `Glass` | macOS alert sound for the fallback banner. |
| `titlePrefix` | `DSH` | Title prefix for the fallback banner. |
| `maxChars` | `120` | Reply/approval preview length. |
| `language` | `zh` | `zh` or `en` copy (fallback banner). |
| `includeSubagents` | `false` | Also alert for child-agent sessions. |
| `notifyOnAbnormalEnd` | `true` | Alert when a turn ends without `completed`. |

## Permission

The first banner needs the system notification permission for DeepSeek Harness.
The Settings page shows the current state and offers an "Allow notifications"
button; the macOS prompt also appears on the first notice.
