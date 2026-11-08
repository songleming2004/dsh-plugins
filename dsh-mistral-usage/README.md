# Mistral usage

Mistral API usage for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A sidebar card and a Settings page that answer two questions the same way the
cost meter answers them for the other plans:

- **How much of the Mistral allowance is left?** The plan and both monthly
  budgets come from Mistral's own billing API, the same two endpoints Vibe
  reads, answered with the ordinary key the `llm-pi-ai` Mistral route already
  uses.
- **What did this Harness spend on Mistral?** Today's and total tokens and an
  estimated cost, per model, folded from the token usage of every Mistral
  request this Harness routed — every session, across restarts.

It also mirrors the allowance into `dsh-cost-meter`'s quota card named
**Mistral**, so it sits beside the other plans on the sidebar and under
Settings › Cost › Quotas.

## Where the account figures come from

| Endpoint | Returns |
|---|---|
| `GET /v1/billing/subscription` | `plan_name` (e.g. `EDU`), `payg_enabled`, `vibe_payg_enabled`, `enterprise` |
| `GET /v1/billing/budget` | `vibe_budget` and `api_budget`, each with `initial_budget`, `usage_percentage`, `currency`, `reset_at` |

Both answer to an **ordinary API key** — no Admin API and no Enterprise plan
needed. Only `api_budget` is used: `vibe_budget` measures what Vibe spent inside
its own harness, not what this API key spent. (The Admin API at `/v1/admin/usage` is a different, Enterprise-only
surface; a standard key gets `401` there.) A key without the
`see_org_inference_usage` permission gets `403` on the budget read; the plan
still comes through and the card falls back to this Harness's own spend.

## What the sidebar card shows

The card lives in the `sidebar.footer.action` seat, above the Settings button:

- the plugin name and the plan (`EDU`, …);
- a Mistral-orange progress bar for the **API budget** — the money this key
  actually spends. The Vibe allowance is deliberately not shown: Vibe consumes
  it inside its own harness, so it is not this key's spend;
- the amount used against the limit, and when it resets;
- today's tokens, and today's call count with the estimated cost.

**Clicking the card re-reads everything**: it asks the Host for a fresh probe,
so the billing API is queried again and the bar, the amounts and today's tokens
update in place. The card pulses while the request is in flight, and Enter or
Space does the same from the keyboard. The 60 s poll in between reuses the
Host's cached answer, so a click is the way to force a re-read.

In the collapsed 56px rail the same figure becomes a ring with the percentage.

## What the Settings page shows

Settings › **Mistral usage**:

- **Account allowance** — the API budget with used / limit, percentage and
  reset time, plus the plan and whether pay-as-you-go is on.
- **This Harness** — today and all sessions: tokens, calls and estimated cost,
  then a per-model table for today with the price source of each row
  (`your config`, `pi-ai catalog`, `Mistral price list`, `default estimate`).
- **Cost meter** — whether the mirror into `dsh-cost-meter` is live.
- **API key** — whether `MISTRAL_API_KEY` is configured, where it came from,
  and a field to replace or remove it through the Harness credential service.

The same facts are available to the agent as the `mistral_usage` tool.

## How the ledger is built

The figure covers **every session in this Harness, across restarts**:

1. **History** is rebuilt from the durable session log on activation: the
   plugin scans `~/.dsh/sessions/*/*/session.v4.jsonl.zstd` and folds the
   `usage` of every `assistant/message` event whose provider starts with
   `mistral`, bucketed by local day. The logs are concatenated zstd frames,
   which Node's own decompressor stops after the first frame of, so the `zstd`
   CLI is used (a Node fallback returns the first frame if the CLI is missing).
2. **Live calls** are counted by an `llm/stream` listener as they stream.

The two never overlap: the scan only counts events older than the activation
instant, and the listener only sees calls after it. Per-file folds are cached
in `~/.dsh/mistral-usage-ledger-cache.json` by size and mtime, so a restart
re-reads only the logs that changed.

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
time, adding a `mistral` entry whose quota query reads exactly the billing
endpoints above and returns the same normalized windows
(`monthly` = the API budget), plus a text `balance` row with the remaining
amount. The Vibe allowance is not mirrored either, for the same reason.

```js
// installed dsh-cost-meter, lib/coding-plans.js
CODING_PLAN_PROVIDERS.mistral = { label: 'Mistral', credentialEnvs: ['MISTRAL_API_KEY'], keyHint: '…' }
```

The card then appears wherever the cost meter's plan cards appear — the
sidebar quota box, the collapsed rail, and Settings › Cost › Quotas — with the
same enable switch, display position and refresh interval as every other
plan. Turning it on: Settings › Cost › Quotas › Mistral → enable, display
`both`.

The mirror is best-effort by design: when `dsh-cost-meter` is not installed
the hook is skipped, and the sidebar card and Settings page keep working on
their own. Set `costMeter: false` in the row config to skip it entirely.

## Configuration

Edit the row in the profile's `cordis.patch.yml` (a patch replaces the whole
`config`, so repeat every key you keep):

```yaml
- id: mistral-usage
  name: '@local/dsh-mistral-usage'
  config:
    apiKeyEnv: MISTRAL_API_KEY      # credential reference holding the key
    baseURL: https://api.mistral.ai # Mistral API root
    currency: EUR                   # currency used when the API names none
    barMax: 125                     # fallback 100% when no API budget is reported
    requestTimeoutMs: 15000         # per-request timeout
    costMeter: true                 # mirror into dsh-cost-meter
    prices:                         # optional per-model overrides
      deepseek-v4-1-flash-1017:
        input: 0.3
        output: 1.2
        cacheRead: 0.007
```

## Layout

| File | Role |
| --- | --- |
| `index.js` | Host half: credential lookup, billing probe, per-day ledger, cost-meter mirror, HTTP bridge, `mistral_usage` tool |
| `client.js` | Client half: sidebar card, Settings page, styles, copy |
| `cordis.patch.yml` | The loader row that inserts the plugin |
| `locale/{en,zh}.json` | Plugin Manager title and description |
| `icon.svg` | Original gauge mark in the Mistral ramp |

The Client talks to the Host through a same-origin JSON bridge at
`/api/mistral-usage/summary` and `/api/mistral-usage/key`; cross-site requests
and non-loopback peers are refused.

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

The Host checks cover billing normalization, the session-log fold, the quota
answer's window shape, and the cost-meter entry's install/dispose. The Client
checks drive `apply()` against a stand-in context and render both surfaces, so
a broken slot registration or a missing figure fails without a browser.

## Requirements

- DSH `>= 0.2.0`
- A Mistral API key in `MISTRAL_API_KEY` (or set `apiKeyEnv` to another name)
- No runtime dependencies — the package is plain ESM over Node built-ins
- Optional: `dsh-cost-meter` for the quota-card mirror

## Notes

- Nothing is sent anywhere except to `api.mistral.ai` with your own key.
- The ledger is rebuilt from session logs on every activation, so restarting
  the Harness does not reset the figure.
- The plugin registers no `sidebar.panellist` entry; the card lives in
  `sidebar.footer.action` and the page in `settings.section`.

## License

MIT
