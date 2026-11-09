# Mistral usage

Usage for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
for two providers on one card and one page:

- **Mistral** — the plan and monthly API budget from Mistral's own billing API,
  plus the tokens and estimated cost this Harness spent on Mistral models.
- **Magpie** — the subscriptions and quota windows the local
  [Magpie](https://github.com/yetone/magpie) gateway reports, plus the calls,
  tokens and priced cost it routed.

Which one a surface shows **follows the session's model route**: a session
running through the `magpie` provider shows Magpie, a session on the Mistral
route shows Mistral. Switching models switches the card; clicking the card
refreshes whatever it is showing. A manual pick overrides the route until the
route changes again.

It also mirrors both allowances into `dsh-cost-meter`'s quota cards named
**Mistral** and **Magpie**, so they sit beside the other plans on the sidebar
and under Settings › Cost › Quotas.

## Where the figures come from

### Mistral

| Endpoint | Returns |
|---|---|
| `GET /v1/billing/subscription` | `plan_name` (e.g. `EDU`), `payg_enabled`, `vibe_payg_enabled`, `enterprise` |
| `GET /v1/billing/budget` | `vibe_budget` and `api_budget`, each with `initial_budget`, `usage_percentage`, `currency`, `reset_at` |

Both answer to an **ordinary API key** — no Admin API and no Enterprise plan
needed. Only `api_budget` is used: `vibe_budget` measures what Vibe spent inside
its own harness, not what this API key spent. A key without the
`see_org_inference_usage` permission gets `403` on the budget read; the plan
still comes through and the card falls back to this Harness's own spend.

The Harness's own Mistral spend is folded from the token usage of every Mistral
request this Harness routed — every session, across restarts (see
[How the ledger is built](#how-the-ledger-is-built)).

### Magpie

Magpie is a local app that runs an OpenAI-compatible gateway on
`http://127.0.0.1:3425`. Besides serving models it reports its own figures, and
the plugin reads exactly those rather than re-counting anything:

| Endpoint | Returns |
|---|---|
| `GET /v1/magpie/quotas` | one entry per subscription: `provider`, `name`, `plan`, and `windows` with `used` (percent), `amount`, `limit`, `remaining`, `unit`, `resetsAt` |
| `GET /v1/magpie/usage?period=today\|7d\|30d\|all` | `calls`, `errors`, token buckets, `cost`, `unpriced`, plus `series` (per hour or day), `models`, `agents` and `sessionCount` |

Both answer on the loopback interface **without a credential**; a gateway key is
only needed when Magpie is shared on the network, and then the plugin sends
`MAGPIE_GATEWAY_KEY`. Magpie prices its own calls, so no local price table is
involved — the cost is what the gateway recorded.

The subscription Magpie served most recently (`last: true`) leads the card;
every subscription is listed on the Settings page.

A Magpie-routed call is **not** folded into the local Mistral ledger: Magpie
reports its own traffic, so counting it in both places would double it.

## What the sidebar card shows

The card lives in the `sidebar.footer.action` seat, above the Settings button:

- the provider name and its plan;
- a switch (`Mistral` | `Magpie`) — clicking a segment picks that provider, and
  clicking the picked one again goes back to following the session;
- a progress bar for the allowance — Mistral orange for the API budget, the
  feather ramp for Magpie;
- the amount used against the limit, and when it resets;
- today's tokens, and today's call count with the cost.

**Clicking the card re-reads everything** — the billing API or the gateway is
queried again and the bar, the amounts and today's tokens update in place. The
card pulses while the request is in flight, and Enter or Space does the same
from the keyboard. The 60 s poll in between reuses the Host's cached answer, so
a click is the way to force a re-read.

In the collapsed 56px rail the same figure becomes a ring with the percentage.

When the Magpie gateway is not running, the card says so instead of drawing a
zero.

## What the Settings page shows

Settings › **Mistral usage**, with the same provider switch:

**Mistral**

- **Account allowance** — the API budget with used / limit, percentage and
  reset time, plus the plan and whether pay-as-you-go is on.
- **This Harness** — today and all sessions: tokens, calls and estimated cost,
  then a per-model table for today with the price source of each row
  (`your config`, `pi-ai catalog`, `Mistral price list`, `default estimate`).
- **Cost meter** — whether the mirror into `dsh-cost-meter` is live.

**Magpie**

- **Account allowance** — every subscription with each of its windows, the
  amount used against the limit and the reset time.
- **Magpie traffic** — a window switch (`Today`, `7 days`, `30 days`, `All`),
  then tokens, calls, errors, cost and session count for that window, a
  per-model table and a per-agent table, and the file Magpie records into.
- **API key** — Magpie needs none on the loopback interface; the card says so.

The same facts are available to the agent as the `mistral_usage` tool, with a
`provider` argument.

## How the ledger is built

The Mistral figure covers **every session in this Harness, across restarts**:

1. **History** is rebuilt from the durable session log on activation: the
   plugin scans `~/.dsh/sessions/*/*/session.v4.jsonl.zstd` and folds the
   `usage` of every `assistant/message` event whose provider is the direct
   Mistral route, bucketed by local day. The logs are concatenated zstd frames,
   which Node's own decompressor stops after the first frame of, so the `zstd`
   CLI is used (a Node fallback returns the first frame if the CLI is missing).
2. **Live calls** are counted by an `llm/stream` listener as they stream.

The two never overlap: the scan only counts events older than the activation
instant, and the listener only sees calls after it. Per-file folds are cached
in `~/.dsh/mistral-usage-ledger-cache.json` by size and mtime, so a restart
re-reads only the logs that changed.

That same listener is how the plugin learns **which provider a session is on**:
every `llm/stream` call names its `sessionId` and `provider`, so the card
follows a model switch without asking the user.

Cost is estimated from the token counts:

```
cacheCost = (cacheRead × price.cacheRead + cacheWrite × price.cacheWrite) / 1_000_000
cost      = (input × price.input + output × price.output) / 1_000_000 + cacheCost
```

Prices are USD per million tokens, resolved in this order: the row config's
`prices`, the installed pi-ai catalog, the published Mistral price list
embedded in `index.js`, then a last-resort default. The invoice is
authoritative.

## The cost-meter mirror

`dsh-cost-meter` renders one quota card per provider in its
`CODING_PLAN_PROVIDERS` list. This bundle publishes into that list at load
time, adding a `mistral` entry whose quota query reads the billing endpoints
above and a `magpie` entry whose query reads `/v1/magpie/quotas` — one window
per subscription plus a remaining-balance row.

```js
// installed dsh-cost-meter, lib/coding-plans.js
CODING_PLAN_PROVIDERS.mistral = { label: 'Mistral', credentialEnvs: ['MISTRAL_API_KEY'], keyHint: '…' }
CODING_PLAN_PROVIDERS.magpie  = { label: 'Magpie',  credentialEnvs: ['MAGPIE_GATEWAY_KEY'], keyHint: '…' }
```

The cards then appear wherever the cost meter's plan cards appear — the sidebar
quota box, the collapsed rail, and Settings › Cost › Quotas — with the same
enable switch, display position and refresh interval as every other plan.

The mirror is best-effort by design: when `dsh-cost-meter` is not installed the
hook is skipped, and the sidebar card and Settings page keep working on their
own. Set `costMeter: false` in the row config to skip it entirely.

## Configuration

Edit the row in the profile's `cordis.patch.yml` (a patch replaces the whole
`config`, so repeat every key you keep):

```yaml
- id: mistral-usage
  name: '@local/dsh-mistral-usage'
  config:
    apiKeyEnv: MISTRAL_API_KEY               # credential reference holding the key
    baseURL: https://api.mistral.ai          # Mistral API root
    currency: EUR                            # currency used when the API names none
    barMax: 125                              # fallback 100% when no API budget is reported
    requestTimeoutMs: 15000                  # per-request timeout
    costMeter: true                          # mirror into dsh-cost-meter
    magpieBaseURL: http://127.0.0.1:3425     # the local Magpie gateway
    magpieKeyEnv: MAGPIE_GATEWAY_KEY         # only needed when the gateway is shared
    prices:                                  # optional per-model overrides
      deepseek-v4-1-flash-1017:
        input: 0.3
        output: 1.2
        cacheRead: 0.007
```

## Layout

| File | Role |
| --- | --- |
| `index.js` | Host half: credential lookup, billing probe, Magpie reads, per-day ledger, route tracking, cost-meter mirror, HTTP bridge, `mistral_usage` tool |
| `client.js` | Client half: sidebar card, provider switch, Settings page, styles, copy |
| `cordis.patch.yml` | The loader row that inserts the plugin |
| `locale/{en,zh}.json` | Plugin Manager title and description |
| `icon.svg` | Original gauge mark in the Mistral ramp |

The Client talks to the Host through a same-origin JSON bridge at
`/api/mistral-usage/summary` and `/api/mistral-usage/key`; cross-site requests
and non-loopback peers are refused. The path keeps its original name so an
installed profile keeps working across the upgrade.

## Install

Install through Plugin Manager (Plugins → Install → pick this directory), or:

```sh
dsh plugin --profile desktop add "link:$HOME/.dsh/plugins/dsh-mistral-usage"
```

Restart the app (the Host half registers the bridge and the tool). The sidebar
card and the Settings section appear immediately after the restart.

## Checks

```sh
node --test test/index.test.mjs test/client.test.mjs
```

The Host checks cover billing normalization, the session-log fold, the Magpie
normalizers, route tracking, the quota answers' window shape, and the
cost-meter entry's install/dispose. The Client checks drive `apply()` against a
stand-in context and render both surfaces for both providers, so a broken slot
registration, a missing figure or a switch that does not follow the route fails
without a browser.

## Requirements

- DSH `>= 0.2.0`
- A Mistral API key in `MISTRAL_API_KEY` (or set `apiKeyEnv` to another name)
  for the Mistral view
- Magpie running locally for the Magpie view (no key needed)
- No runtime dependencies — the package is plain ESM over Node built-ins
- Optional: `dsh-cost-meter` for the quota-card mirror

## Notes

- Nothing is sent anywhere except to `api.mistral.ai` (with your own key) and
  to your own Magpie gateway on the loopback interface.
- The Mistral ledger is rebuilt from session logs on every activation, so
  restarting the Harness does not reset the figure.
- The plugin registers no `sidebar.panellist` entry; the card lives in
  `sidebar.footer.action` and the page in `settings.section`.

## License

MIT
