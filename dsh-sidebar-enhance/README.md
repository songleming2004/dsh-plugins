# Sidebar enhance

One local plugin bundle with two browser-side components over the right
Sidebar. Plugin Manager lists it as a single plugin.

| Component | What it does |
| --- | --- |
| `SidebarWidthGuard` (`@local/dsh-sidebar-enhance:width-guard`) | When a Session's right Sidebar is opened for the first time after a fresh app launch, cap its width at one third of "panel + conversation". |
| `SidebarScrollEnhancer` (`@local/dsh-sidebar-enhance:scroll`) | Let every right-Sidebar page body scroll vertically, so a long tool list or tool page is never cut off. |

## The width rule

The layout package opens the right column at `RIGHTBAR_DEFAULT_RATIO = 0.45` of
the frame, which on a normal desktop makes the panel slightly wider than the
conversation beside it. With `R` the panel and `C` the conversation, this bundle
enforces

```
R ≤ (R + C) / 3
```

which is

```
R = (frameWidth − sidebarWidth) / 3
```

clamped to the layout contract's 300px floor. On a 1512px frame with the
280px left column that is 410px instead of 680px.

The cap is applied **once per Session per app run**, on the first opening only.
The ids live in memory, so a restart or a new Session gets a fresh first-open
cap, while a later drag — narrower or wider — is preserved for the rest of that
Session.

`ctx.layout` exposes no width action, so the guard uses the two doors the
product itself uses:

1. The frame's `AppFrame` receives the bound layout `actions`; walking the React
   fiber from the frame DOM node reaches `actions.setRightbar(px)`, exactly what
   the built-in resize handle calls. This lands before the first paint, so the
   panel opens directly at the target width.
2. If that access ever fails (a future React/build change), the guard
   synthesises a pointer drag on the product's own `[data-side="rightbar"]`
   handle, which drives the same store action through the public event path.

## The scroll rule

A tab body in the right Sidebar is fixed to `height: 100%` with
`overflow: hidden`, while its scrolling parent is `overflow: auto`. A page taller
than the pane — the guide with many tool cards is the common case — was clipped
and the parent never learned it should scroll.

There is a second trap in the guide: it centres its cards with
`justify-content: center`. Cards taller than the pane then overflow the top
**and** the bottom, but a scroll container only exposes the bottom overflow, so
the first tools can never be scrolled into view.

The scroll component's stylesheet fixes both and makes the scrollbar
discoverable:

```css
[data-sidebar-right-session] [data-sidebar-right-tab] {
  overflow-y: auto !important;
  overflow-x: hidden !important;
  overscroll-behavior-y: contain;
}

/* Centre while the cards fit; start-align once they overflow, so the first
   card is reachable at scrollTop = 0. */
[data-sidebar-right-session] [data-sidebar-right-guide] {
  justify-content: safe center !important;
}

/* macOS overlay scrollbars are invisible until scrolling; styling the WebKit
   scrollbar draws a classic 10px, always-visible, draggable thumb. Surfaces
   that do not overflow show nothing and lose no width. */
[data-sidebar-right-session] [data-sidebar-right-tab]::-webkit-scrollbar {
  width: 10px;
}
```

Pages that already manage their own scroll keep working; a scrollable child
also gets the same visible thumb. A page that fits loses no width.

Finally, the guide's own bottom spacer is a shrinkable `:after` flex item: once
the cards overflow it collapses to zero, so at maximum scroll the last card sat
flush against the panel edge. Pseudo-elements and a bottom margin on the last
card are not counted in the guide's scrollable overflow, so the component
appends a real 24px flex child (`[data-dsh-sidebar-bottom-spacer]`) as the
guide's last item and re-appends it after React rerenders. Together with the
guide's 14px row gap, scrolling to the end leaves about 38px of breathing room
below “More tools”.

## Shape

```
dsh-sidebar-enhance/
  package.json          # @local/dsh-sidebar-enhance, dsh.bundle.patch + dsh.client
  cordis.patch.yml      # the Host row (no-op: both features are browser-side)
  index.js              # Host half (no registration)
  client.js             # both components and their install/dispose logic
  locale/{en,zh}.json   # Plugin Manager title and description
  icon.svg
  test/                 # node --test harness for the width solve and scroll install
```

## Install / verify

Install through Plugin Manager (Plugins → Install → pick this directory), or:

```sh
dsh plugin --profile desktop add "link:$HOME/.dsh/plugins/dsh-sidebar-enhance"
```

Refresh the page after the bundle is installed (a Host restart is not needed).
Run the checks with:

```sh
node --test test/client.test.mjs
```
