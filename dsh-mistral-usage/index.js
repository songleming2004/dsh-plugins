/**
 * Host half of the Mistral usage bundle.
 *
 * Three jobs, all owned by one plugin row:
 *
 * 1. Read the Mistral account's plan and monthly allowance from Mistral's
 *    public billing API with the key the `llm-pi-ai` Mistral route already uses.
 * 2. Fold the token usage of every Mistral request this Harness routed into
 *    one ledger, so the panel can show today's tokens and cost, per model,
 *    across sessions and across restarts.
 * 3. Mirror the same figures into `dsh-cost-meter`'s Coding Plan quota card
 *    when that plugin is installed, so the Mistral allowance sits beside the
 *    other plans in the sidebar and the Settings › Cost › Quotas page.
 *
 * Nothing here renders; the Client module owns the sidebar card and the
 * Settings page. The Client talks to this half over a same-origin JSON bridge
 * at `/api/mistral-usage/...`.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bridge prefix shared with `client.js`; keep both in sync. */
const BRIDGE_PREFIX = "/api/mistral-usage";
/** Default credential reference: the name the pi-ai Mistral route resolves. */
const DEFAULT_API_KEY_ENV = "MISTRAL_API_KEY";
/** Default Mistral API root. */
const DEFAULT_BASE_URL = "https://api.mistral.ai";
/** Largest accepted JSON request body. */
const MAX_JSON_BODY_BYTES = 64 * 1024;
/** Largest accepted Mistral response body. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Largest session log this scan will decompress, per file. */
const MAX_SESSION_BYTES = 512 * 1024 * 1024;
/** Per-file timeout for the external decompressor. */
const DECOMPRESS_TIMEOUT_MS = 30_000;
/** Cache of per-file folds, so a restart only re-reads logs that changed. */
const LEDGER_CACHE_NAME = "mistral-usage-ledger-cache.json";
/** Provider id this bundle publishes into `dsh-cost-meter`'s Coding Plan list. */
const COST_METER_PROVIDER = "mistral";
/** How long a `dsh-cost-meter` answer is trusted before asking again. */
const COST_METER_TTL_MS = 60_000;

/**
 * The public billing endpoints Vibe itself reads (mistralai/mistral-vibe,
 * `vibe/app_server/_billing.py`). They answer to an ordinary API key — no
 * Admin API and no Enterprise plan needed — and report the plan plus how much
 * of each monthly budget is consumed.
 */
const BILLING_SUBSCRIPTION_PATH = "/v1/billing/subscription";
const BILLING_BUDGET_PATH = "/v1/billing/budget";

/**
 * USD prices per million tokens, from Mistral's published price list
 * (https://docs.mistral.ai/inference/pricing). Used for any model the
 * installed pi-ai catalog does not describe, which is the case for the
 * third-party models Mistral hosts. A row config's `prices` overrides both.
 */
const PUBLISHED_PRICES = {
  "deepseek-v4-1-flash-1017": { input: 0.3, output: 1.2, cacheRead: 0.007, cacheWrite: 0 },
  "zai-glm-5-3-flash": { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
  "zai-glm-5-3": { input: 1.4, output: 4.4, cacheRead: 0.14, cacheWrite: 0 },
  "mistral-small-4": { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
  "mistral-large-4": { input: 0.7, output: 2.1, cacheRead: 0.07, cacheWrite: 0 },
  "ministral-3-14b": { input: 0.2, output: 0.2, cacheRead: 0.02, cacheWrite: 0 },
  "ministral-3-8b": { input: 0.15, output: 0.15, cacheRead: 0.015, cacheWrite: 0 },
  "ministral-3-3b": { input: 0.1, output: 0.1, cacheRead: 0.01, cacheWrite: 0 },
  codestral: { input: 0.3, output: 0.9, cacheRead: 0.03, cacheWrite: 0 },
};
/** Last-resort prices when neither the catalog nor the table describes a model. */
const UNKNOWN_PRICES = { input: 0.3, output: 1.2, cacheRead: 0.007, cacheWrite: 0 };

// #region helpers

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response to complete.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serializable body.
 */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  res.end(payload);
}

/**
 * Read a bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<unknown | undefined>} parsed body, or undefined when malformed or oversized.
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) return undefined;
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Whether a loopback hostname names this machine.
 * @param {string} hostname - lowercased hostname without brackets.
 * @returns {boolean} true for loopback spellings.
 */
function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/**
 * Whether a socket address is loopback.
 * @param {string | undefined} address - `req.socket.remoteAddress`.
 * @returns {boolean} true for loopback addresses.
 */
function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/**
 * Same-origin guard for the bridge: the browser page and this Host share one
 * origin, so a cross-site request is refused and a loopback Host must come
 * from a loopback peer.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {boolean} true when the request may be served.
 */
function isBridgeRequestAllowed(req) {
  const host = req.headers.host;
  if (typeof host !== "string" || host.length === 0) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  let hostname;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (isLoopbackHostname(hostname)) return isLoopbackAddress(req.socket.remoteAddress);
  const localAddress = req.socket.localAddress;
  if (typeof localAddress === "string" && localAddress !== "0.0.0.0" && localAddress !== "::") {
    return localAddress === hostname || localAddress === `::ffff:${hostname}`;
  }
  return false;
}

/**
 * Format an amount for the model-facing text summary.
 * @param {number | null | undefined} value - amount.
 * @param {string} currency - currency code.
 * @returns {string} display string.
 */
function money(value, currency) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const code = currency || "USD";
  const symbol = code === "USD" ? "$" : code === "EUR" ? "€" : "";
  const fixed = Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(2);
  return symbol === "" ? `${fixed} ${code}` : `${symbol}${fixed}`;
}

/**
 * Normalize one budget object (`vibe_budget` or `api_budget`) into a spend view.
 * @param {unknown} detail - the raw budget object.
 * @param {string} kind - `vibe` or `api`.
 * @returns {{ kind: string; spent: number; limit: number; percent: number; currency?: string; resetAt?: string; payg: boolean } | undefined} the view.
 */
function normalizeBudget(detail, kind) {
  if (detail === null || typeof detail !== "object") return undefined;
  const record = /** @type {Record<string, unknown>} */ (detail);
  const limit = Number(record.initial_budget);
  const percent = Number(record.usage_percentage);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(percent)) return undefined;
  const clamped = Math.max(0, percent);
  return {
    kind,
    spent: (limit * clamped) / 100,
    limit,
    percent: clamped,
    currency: typeof record.currency === "string" ? record.currency : undefined,
    resetAt: typeof record.reset_at === "string" ? record.reset_at : undefined,
    payg: record.payg_enabled === true,
  };
}

/**
 * Normalize the two billing answers into the consumption view the panel reads.
 * @param {unknown} subscription - `/v1/billing/subscription` body.
 * @param {unknown} budget - `/v1/billing/budget` body.
 * @param {string} fallbackCurrency - currency used when the API names none.
 * @returns {object | undefined} the view, or undefined when neither answer carried data.
 */
function normalizeBilling(subscription, budget, fallbackCurrency) {
  const plan =
    subscription !== null && typeof subscription === "object" && Object.keys(/** @type {object} */ (subscription)).length > 0
      ? /** @type {Record<string, unknown>} */ (subscription)
      : undefined;
  const budgets = budget !== null && typeof budget === "object" ? /** @type {Record<string, unknown>} */ (budget) : undefined;
  const vibe = normalizeBudget(budgets?.vibe_budget, "vibe");
  const api = normalizeBudget(budgets?.api_budget, "api");
  if (plan === undefined && vibe === undefined && api === undefined) return undefined;
  const currency = vibe?.currency ?? api?.currency ?? fallbackCurrency;
  return {
    plan: typeof plan?.plan_name === "string" ? plan.plan_name : undefined,
    enterprise: plan?.enterprise === true,
    payg: plan?.payg_enabled === true || plan?.vibe_payg_enabled === true,
    vibe,
    api,
    currency,
    spent: vibe?.spent,
    limit: vibe?.limit,
    remaining: vibe !== undefined ? Math.max(0, vibe.limit - vibe.spent) : undefined,
    percent: vibe?.percent,
    resetAt: vibe?.resetAt ?? api?.resetAt,
  };
}

/**
 * Detect a Mistral "invalid key" answer in any of its shapes.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - parsed body, when JSON.
 * @returns {string | undefined} human-readable reason when the key was refused.
 */
function refusalReason(status, payload) {
  if (status === 401 || status === 403) {
    const detail =
      payload !== null && typeof payload === "object"
        ? /** @type {Record<string, unknown>} */ (payload).detail ?? /** @type {Record<string, unknown>} */ (payload).message
        : undefined;
    return typeof detail === "string" && detail.length > 0 ? detail : `HTTP ${status}`;
  }
  return undefined;
}

/**
 * Local calendar day key (`YYYY-MM-DD`) for a timestamp.
 * @param {number} at - epoch milliseconds.
 * @returns {string} the day key.
 */
function dayKey(at) {
  const when = new Date(at);
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

/** Largest number of day buckets the ledger keeps. */
const LEDGER_DAYS = 400;

// #endregion

// #region durable history

/**
 * The DSH home directory holding `sessions/`.
 * @returns {string} absolute path.
 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return path.join(os.homedir(), ".dsh");
}

/**
 * Every `session.v4.jsonl.zstd` under `<home>/sessions/<workspace>/<session>/`.
 * @returns {string[]} absolute file paths.
 */
function listSessionFiles() {
  const root = path.join(dshHome(), "sessions");
  const files = [];
  let workspaces;
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = path.join(root, workspace.name);
    let sessions;
    try {
      sessions = fs.readdirSync(workspaceDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const file = path.join(workspaceDir, session.name, "session.v4.jsonl.zstd");
      try {
        if (fs.statSync(file).isFile()) files.push(file);
      } catch {
        /* vanished between listing and stat */
      }
    }
  }
  return files;
}

/**
 * Decompress a session log. The log is a concatenation of zstd frames, which
 * Node's own decompressor stops after the first frame of, so the `zstd` CLI is
 * preferred; a Node fallback still returns the first frame when the CLI is
 * absent.
 * @param {string} file - absolute log path.
 * @returns {Promise<string | undefined>} decompressed text, or undefined on failure.
 */
async function decompressSession(file) {
  try {
    const { stdout } = await execFileAsync("zstd", ["-dc", file], {
      maxBuffer: MAX_SESSION_BYTES,
      timeout: DECOMPRESS_TIMEOUT_MS,
      encoding: "utf8",
    });
    return stdout;
  } catch {
    try {
      return zlib.zstdDecompressSync(fs.readFileSync(file)).toString("utf8");
    } catch {
      return undefined;
    }
  }
}

/**
 * Fold one decompressed log into per-day, per-model Mistral usage, counting
 * only events older than `cutoffMs` so the live waterfall and this history
 * never overlap.
 * @param {string} raw - decompressed JSONL text.
 * @param {number} cutoffMs - exclusive upper bound on an event's `time`.
 * @returns {{ days: Record<string, object>; maxTime: number }} the fold.
 */
function foldSession(raw, cutoffMs) {
  const days = {};
  let maxTime = 0;
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event.time === "number" && event.time > maxTime) maxTime = event.time;
    if (event.type !== "assistant/message") continue;
    const data = event.data ?? event;
    const usage = data.usage;
    if (usage === null || typeof usage !== "object") continue;
    const source = data.message?.source ?? {};
    if (!/^mistral/i.test(String(source.provider ?? ""))) continue;
    if (typeof event.time === "number" && event.time >= cutoffMs) continue;
    const model = String(source.model ?? "unknown");
    const at = typeof event.time === "number" ? event.time : Date.now();
    const key = dayKey(at);
    const day = days[key] ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, byModel: {} };
    const input = Number(usage.inputTokens ?? 0);
    const output = Number(usage.outputTokens ?? 0);
    const cacheRead = Number(usage.cacheReadTokens ?? 0);
    const cacheWrite = Number(usage.cacheWriteTokens ?? 0);
    const reasoning = Number(usage.reasoningTokens ?? 0);
    day.calls += 1;
    day.input += input;
    day.output += output;
    day.cacheRead += cacheRead;
    day.cacheWrite += cacheWrite;
    day.reasoning += reasoning;
    const entry = day.byModel[model] ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    entry.calls += 1;
    entry.input += input;
    entry.output += output;
    entry.cacheRead += cacheRead;
    entry.cacheWrite += cacheWrite;
    day.byModel[model] = entry;
    days[key] = day;
  }
  return { days, maxTime };
}

// #endregion

// #region usage service

/**
 * Owns the credential lookup, the billing probe, the local token ledger and
 * the mirror into `dsh-cost-meter`.
 */
class MistralUsage {
  /**
   * @param {object} options - resolved plugin config plus the owning context.
   * @param {import('@deepseek-ai/cordis').Context} options.ctx - plugin context.
   * @param {string} options.apiKeyEnv - credential reference holding the key.
   * @param {string} options.baseURL - Mistral API root.
   * @param {string} options.currency - currency of the billing figures.
   * @param {number} options.barMax - spend at which the sidebar bar reads 100% when no budget is reported.
   * @param {number} options.requestTimeoutMs - per-request timeout.
   * @param {boolean} options.costMeter - whether to publish into `dsh-cost-meter`.
   * @param {object} options.logger - Cordis logger.
   */
  constructor(options) {
    this.ctx = options.ctx;
    this.apiKeyEnv = options.apiKeyEnv;
    this.baseURL = options.baseURL.replace(/\/+$/, "");
    this.currency = options.currency;
    this.barMax = options.barMax;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.costMeterEnabled = options.costMeter !== false;
    this.logger = options.logger;
    /**
     * Per-day Mistral usage this Harness routed: `{ [YYYY-MM-DD]: { calls,
     * input, output, cacheRead, cacheWrite, reasoning, byModel } }`. Kept per
     * day so "today" is a lookup, not a second scan.
     */
    this.days = {};
    /** Last billing answer, kept so a failed refresh still shows the previous figure. */
    this.lastConsumption = undefined;
    /** Last billing failure, cleared by the next success. */
    this.lastFailure = undefined;
    /** Whether the durable history has been folded yet. */
    this.seeded = false;
    /** Resolves once the history fold has finished (or failed). */
    this.seedPromise = undefined;
    /** Last `dsh-cost-meter` answer, so a burst of polls asks once. */
    this.costMeterCache = undefined;
    /** In-flight `dsh-cost-meter` call. */
    this.costMeterInFlight = undefined;
  }

  /**
   * Resolve the key through the credential seam, falling back to the process
   * environment when the seam is absent or holds nothing.
   * @returns {Promise<{ value: string; source: string } | undefined>} the key and where it came from.
   */
  async resolveKey() {
    const credentials = this.ctx.get("credentials");
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(this.apiKeyEnv);
        if (hit !== undefined && hit.value.length > 0) return { value: hit.value, source: hit.source };
      } catch (error) {
        this.logger.warn(`mistral-usage: credential lookup for ${this.apiKeyEnv} failed: ${String(error)}`);
      }
    }
    const ambient = process.env[this.apiKeyEnv];
    if (typeof ambient === "string" && ambient.trim().length > 0) return { value: ambient.trim(), source: "environment" };
    return undefined;
  }

  /**
   * Describe the credential without exposing it.
   * @returns {Promise<object>} configured state, source, and writability.
   */
  async describeKey() {
    const credentials = this.ctx.get("credentials");
    if (credentials !== undefined) {
      try {
        const info = await credentials.describe(this.apiKeyEnv);
        return { ref: this.apiKeyEnv, configured: info.configured, source: info.source, writable: info.writable };
      } catch {
        /* fall through to the ambient answer */
      }
    }
    const ambient = process.env[this.apiKeyEnv];
    const configured = typeof ambient === "string" && ambient.trim().length > 0;
    return { ref: this.apiKeyEnv, configured, source: configured ? "environment" : undefined, writable: false };
  }

  /**
   * Store a key through the credential seam.
   * @param {string} value - the raw key.
   * @returns {Promise<object>} the fresh credential description.
   */
  async setKey(value) {
    const credentials = this.ctx.get("credentials");
    if (credentials === undefined) throw new Error("this Harness has no credentials service; export the key in the launching environment instead");
    await credentials.set(this.apiKeyEnv, value);
    this.lastConsumption = undefined;
    return this.describeKey();
  }

  /**
   * Remove the stored key.
   * @returns {Promise<object>} the fresh credential description.
   */
  async clearKey() {
    const credentials = this.ctx.get("credentials");
    if (credentials === undefined) throw new Error("this Harness has no credentials service");
    await credentials.unset(this.apiKeyEnv);
    this.lastConsumption = undefined;
    return this.describeKey();
  }

  /**
   * Ask one billing endpoint.
   * @param {string} route - endpoint path.
   * @param {string} key - resolved API key.
   * @returns {Promise<{ status: number; payload?: unknown; error?: string }>} the answer.
   */
  async probe(route, key) {
    const response = await fetch(`${this.baseURL}${route}`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return { status: response.status, error: "response too large" };
    let payload;
    try {
      payload = text.length === 0 ? undefined : JSON.parse(text);
    } catch {
      return { status: response.status, error: text.slice(0, 200) };
    }
    return { status: response.status, payload };
  }

  /**
   * Read the plan and the monthly budgets from the public billing API.
   *
   * `/v1/billing/subscription` names the plan (EDU, free, …); `/v1/billing/budget`
   * reports `vibe_budget` and `api_budget`, each with `initial_budget`,
   * `usage_percentage`, `currency` and `reset_at`. A key without the
   * `see_org_inference_usage` permission gets 403 on the budget read, which is
   * not an error: the plan still comes through.
   * @returns {Promise<object>} consumption view, or a refusal/unavailable reason.
   */
  async refreshConsumption() {
    const key = await this.resolveKey();
    if (key === undefined) {
      this.lastConsumption = undefined;
      this.lastFailure = { kind: "missing-key", message: `${this.apiKeyEnv} is not configured` };
      return { status: "missing-key", ref: this.apiKeyEnv, message: this.lastFailure.message };
    }
    let subscription;
    let budget;
    let lastError;
    try {
      const planAnswer = await this.probe(BILLING_SUBSCRIPTION_PATH, key.value);
      const refused = refusalReason(planAnswer.status, planAnswer.payload);
      if (refused !== undefined) {
        this.lastConsumption = undefined;
        this.lastFailure = { kind: "invalid-key", message: refused };
        return { status: "invalid-key", ref: this.apiKeyEnv, message: refused };
      }
      if (planAnswer.status === 200 && planAnswer.payload !== null && typeof planAnswer.payload === "object") {
        subscription = planAnswer.payload;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    try {
      const budgetAnswer = await this.probe(BILLING_BUDGET_PATH, key.value);
      if (budgetAnswer.status === 200 && budgetAnswer.payload !== null && typeof budgetAnswer.payload === "object") {
        budget = budgetAnswer.payload;
      }
    } catch (error) {
      lastError = lastError ?? (error instanceof Error ? error.message : String(error));
    }
    const normalized = normalizeBilling(subscription, budget, this.currency);
    if (normalized === undefined) {
      this.lastFailure = {
        kind: "unavailable",
        message:
          lastError ??
          "the billing API returned no plan or budget for this key; usage is only reported for keys on a metered plan",
      };
      return { status: "unavailable", ref: this.apiKeyEnv, message: this.lastFailure.message };
    }
    this.lastConsumption = { ...normalized, fetchedAt: Date.now() };
    this.lastFailure = undefined;
    return { status: "ok", ref: this.apiKeyEnv, source: key.source, ...this.lastConsumption };
  }

  /**
   * Fold one provider usage report into today's bucket.
   * @param {string} model - model id the usage belongs to.
   * @param {object} usage - token counts reported by the provider.
   * @param {number} at - epoch milliseconds of the call.
   */
  record(model, usage, at) {
    const key = dayKey(at);
    const day = this.days[key] ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, byModel: {} };
    const input = Number(usage.inputTokens ?? 0);
    const output = Number(usage.outputTokens ?? 0);
    const cacheRead = Number(usage.cacheReadTokens ?? 0);
    const cacheWrite = Number(usage.cacheWriteTokens ?? 0);
    const reasoning = Number(usage.reasoningTokens ?? 0);
    day.calls += 1;
    day.input += input;
    day.output += output;
    day.cacheRead += cacheRead;
    day.cacheWrite += cacheWrite;
    day.reasoning += reasoning;
    const entry = day.byModel[model] ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    entry.calls += 1;
    entry.input += input;
    entry.output += output;
    entry.cacheRead += cacheRead;
    entry.cacheWrite += cacheWrite;
    day.byModel[model] = entry;
    this.days[key] = day;
    this.prune();
  }

  /** Keep the ledger bounded: only the newest `LEDGER_DAYS` day buckets. */
  prune() {
    const keys = Object.keys(this.days).sort();
    while (keys.length > LEDGER_DAYS) delete this.days[keys.shift()];
  }

  /**
   * Seed the ledger from durable session logs, so a restart does not reset the
   * figure. Only events older than `cutoffMs` are folded: everything newer is
   * counted by the live `llm/stream` listener, so the two never overlap.
   *
   * Per-file folds are cached by size and mtime, so a restart re-reads only the
   * logs that changed since the last run.
   * @param {number} cutoffMs - activation time; later events belong to the live ledger.
   * @returns {Promise<{ files: number; scanned: number; calls: number } | undefined>} a summary, or undefined when unavailable.
   */
  async seedFromSessionLogs(cutoffMs) {
    const files = listSessionFiles();
    if (files.length === 0) {
      this.seeded = true;
      return undefined;
    }
    const cachePath = path.join(dshHome(), LEDGER_CACHE_NAME);
    let cache = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (parsed !== null && typeof parsed === "object" && parsed.files !== null && typeof parsed.files === "object") {
        cache = parsed.files;
      }
    } catch {
      /* first run, or an unreadable cache */
    }
    const nextCache = {};
    let scanned = 0;
    let calls = 0;
    for (const file of files) {
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const cached = cache[file];
      // Reuse a cached fold only when the file is untouched and wholly older
      // than the cutoff; otherwise the file may hold live-era events.
      if (
        cached !== undefined &&
        cached.size === stat.size &&
        cached.mtimeMs === stat.mtimeMs &&
        typeof cached.maxTime === "number" &&
        cached.maxTime < cutoffMs
      ) {
        nextCache[file] = cached;
        mergeDays(this.days, cached.days);
        calls += Number(cached.calls ?? 0);
        continue;
      }
      const raw = await decompressSession(file);
      if (raw === undefined) continue;
      scanned += 1;
      const fold = foldSession(raw, cutoffMs);
      // Cache only a complete fold: a file holding events newer than the cutoff
      // was folded partially, so reusing it later would under-count.
      if (fold.maxTime < cutoffMs) {
        const totals = totalCalls(fold.days);
        nextCache[file] = { size: stat.size, mtimeMs: stat.mtimeMs, maxTime: fold.maxTime, days: fold.days, calls: totals };
      }
      mergeDays(this.days, fold.days);
      calls += totalCalls(fold.days);
    }
    this.prune();
    this.seeded = true;
    try {
      fs.writeFileSync(cachePath, JSON.stringify({ version: 1, files: nextCache }));
    } catch (error) {
      this.logger.warn(`mistral-usage: could not write the ledger cache: ${String(error)}`);
    }
    return { files: files.length, scanned, calls };
  }

  /**
   * Price one day's tokens.
   * @param {object | undefined} day - the day bucket.
   * @param {(model: string) => { prices: object; source: string }} pricesFor - price lookup.
   * @returns {object} the day with `cost`, `cacheCost` and a priced `byModel` list.
   */
  priceDay(day, pricesFor) {
    const empty = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, cacheCost: 0, byModel: [] };
    if (day === undefined) return empty;
    let cost = 0;
    let cacheCost = 0;
    const byModel = [];
    for (const [model, entry] of Object.entries(day.byModel ?? {})) {
      const { prices, source } = pricesFor(model);
      const cache = (entry.cacheRead * prices.cacheRead + entry.cacheWrite * prices.cacheWrite) / 1_000_000;
      const modelCost = (entry.input * prices.input + entry.output * prices.output) / 1_000_000 + cache;
      cost += modelCost;
      cacheCost += cache;
      byModel.push({ model, ...entry, cost: modelCost, cacheCost: cache, priceSource: source });
    }
    byModel.sort((left, right) => right.cost - left.cost);
    return { ...empty, ...day, cost, cacheCost, byModel };
  }

  /**
   * The local ledger as a detached JSON value.
   * @param {(model: string) => { prices: object; source: string }} pricesFor - price lookup.
   * @returns {object} ledger snapshot.
   */
  ledgerView(pricesFor) {
    const today = this.priceDay(this.days[dayKey(Date.now())], pricesFor);
    let total = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, cacheCost: 0 };
    for (const day of Object.values(this.days)) {
      const priced = this.priceDay(day, pricesFor);
      total.calls += priced.calls;
      total.input += priced.input;
      total.output += priced.output;
      total.cacheRead += priced.cacheRead;
      total.cacheWrite += priced.cacheWrite;
      total.reasoning += priced.reasoning;
      total.cost += priced.cost;
      total.cacheCost += priced.cacheCost;
    }
    const history = Object.keys(this.days)
      .sort()
      .slice(-30)
      .map((key) => {
        const priced = this.priceDay(this.days[key], pricesFor);
        return { date: key, calls: priced.calls, tokens: priced.input + priced.output + priced.cacheRead + priced.cacheWrite + priced.reasoning, cost: priced.cost };
      });
    return { today, total, history, currency: "USD", seeded: this.seeded };
  }

  /**
   * Ask `dsh-cost-meter` to describe the enabled Mistral quota card, so the
   * panel can say whether the mirror is live. Never throws.
   * @param {boolean} force - ignore the cached answer.
   * @returns {Promise<object | undefined>} the plan entry, or undefined when the plugin is absent or off.
   */
  async costMeterPlan(force) {
    if (!this.costMeterEnabled) return undefined;
    const remote = this.ctx.get("remote.costMeter");
    if (remote === undefined || typeof remote.getState !== "function") return undefined;
    const cached = this.costMeterCache;
    if (!force && cached !== undefined && Date.now() - cached.at < COST_METER_TTL_MS) return cached.value;
    if (this.costMeterInFlight !== undefined) return this.costMeterInFlight;
    this.costMeterInFlight = (async () => {
      try {
        const answer = await remote.getState();
        const state = answer !== null && typeof answer === "object" && answer.ok === true ? answer.value : undefined;
        const entry = state?.codingPlans?.[COST_METER_PROVIDER];
        const value = entry !== null && typeof entry === "object" ? entry : undefined;
        this.costMeterCache = { at: Date.now(), value };
        return value;
      } catch (error) {
        this.logger.debug?.(`mistral-usage: cost-meter state unavailable: ${String(error)}`);
        this.costMeterCache = { at: Date.now(), value: undefined };
        return undefined;
      } finally {
        this.costMeterInFlight = undefined;
      }
    })();
    return this.costMeterInFlight;
  }

  /**
   * Everything the panel and the tool report.
   * @param {{ refresh?: boolean }} options - whether to re-probe the billing API.
   * @param {(model: string) => { prices: object; source: string }} pricesFor - price lookup.
   * @returns {Promise<object>} the usage view.
   */
  async view(options, pricesFor) {
    if (!this.seeded && this.seedPromise !== undefined) {
      try {
        await this.seedPromise;
      } catch {
        /* a failed fold still leaves the live ledger usable */
      }
    }
    const credential = await this.describeKey();
    let consumption;
    if (options?.refresh === true || this.lastConsumption === undefined) {
      consumption = await this.refreshConsumption();
    } else {
      consumption = { status: "ok", ref: this.apiKeyEnv, ...this.lastConsumption };
    }
    const ledger = this.ledgerView(pricesFor);
    // The bar tracks the API budget the billing API reports. The Vibe allowance
    // is deliberately ignored: it is consumed by Vibe inside its own harness,
    // not by this API key, so showing it here would read as spend that never
    // happened. Without an API budget the bar falls back to this Harness's own
    // Mistral spend against the configured `barMax`.
    const budget = consumption.status === "ok" ? consumption.api : undefined;
    const bar =
      budget !== undefined
        ? {
            value: budget.spent,
            max: budget.limit,
            percent: budget.percent,
            source: "account",
            budget: budget.kind,
            currency: budget.currency ?? this.currency,
            resetAt: budget.resetAt,
            payg: budget.payg,
          }
        : { value: ledger.total.cost, max: this.barMax, source: "harness", currency: ledger.currency };
    const costMeter = await this.costMeterPlan(options?.refresh === true);
    return {
      credential,
      // Only the API budget is exposed: the Vibe allowance belongs to Vibe's own
      // harness, so sending it would invite a surface to show it as this key's.
      // The flat fields are re-led by the API budget for the same reason.
      consumption:
        consumption.status === "ok"
          ? {
              status: consumption.status,
              ref: consumption.ref,
              source: consumption.source,
              plan: consumption.plan,
              enterprise: consumption.enterprise,
              payg: consumption.payg,
              currency: consumption.currency,
              api: consumption.api,
              spent: consumption.api?.spent,
              limit: consumption.api?.limit,
              remaining: consumption.api !== undefined ? Math.max(0, consumption.api.limit - consumption.api.spent) : undefined,
              percent: consumption.api?.percent,
              resetAt: consumption.api?.resetAt,
              fetchedAt: consumption.fetchedAt,
            }
          : consumption,
      ledger,
      bar,
      costMeter: {
        enabled: this.costMeterEnabled,
        connected: costMeter !== undefined,
        display: typeof costMeter?.display === "string" ? costMeter.display : undefined,
        status: typeof costMeter?.status === "string" ? costMeter.status : undefined,
        windows: costMeter?.windows !== null && typeof costMeter?.windows === "object" ? Object.keys(costMeter.windows) : [],
      },
      updatedAt: Date.now(),
    };
  }
}

/**
 * Add one fold's day buckets into a ledger, keeping every token counter.
 * @param {Record<string, object>} target - the ledger to grow.
 * @param {Record<string, object> | undefined} source - the fold to add.
 */
function mergeDays(target, source) {
  if (source === null || typeof source !== "object") return;
  for (const [key, day] of Object.entries(source)) {
    if (day === null || typeof day !== "object") continue;
    const into = target[key] ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, byModel: {} };
    for (const counter of ["calls", "input", "output", "cacheRead", "cacheWrite", "reasoning"]) {
      into[counter] = (into[counter] ?? 0) + (Number(day[counter]) || 0);
    }
    into.byModel = into.byModel ?? {};
    for (const [model, entry] of Object.entries(day.byModel ?? {})) {
      const modelEntry = into.byModel[model] ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (const counter of ["calls", "input", "output", "cacheRead", "cacheWrite"]) {
        modelEntry[counter] = (modelEntry[counter] ?? 0) + (Number(entry?.[counter]) || 0);
      }
      into.byModel[model] = modelEntry;
    }
    target[key] = into;
  }
}

/**
 * Sum the call count of one fold.
 * @param {Record<string, object>} days - day buckets.
 * @returns {number} total calls.
 */
function totalCalls(days) {
  let calls = 0;
  for (const day of Object.values(days ?? {})) calls += Number(day?.calls) || 0;
  return calls;
}

// #endregion

/**
 * Host plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} config - resolved row config.
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger?.("mistral-usage") ?? console;
  const apiKeyEnv = typeof config.apiKeyEnv === "string" && config.apiKeyEnv.length > 0 ? config.apiKeyEnv : DEFAULT_API_KEY_ENV;
  const baseURL = typeof config.baseURL === "string" && config.baseURL.length > 0 ? config.baseURL : DEFAULT_BASE_URL;
  const currency = typeof config.currency === "string" && config.currency.length > 0 ? config.currency.toUpperCase() : "EUR";
  const barMax = Number.isFinite(config.barMax) && config.barMax > 0 ? config.barMax : 125;
  const requestTimeoutMs = Number.isFinite(config.requestTimeoutMs) && config.requestTimeoutMs > 0 ? config.requestTimeoutMs : 15_000;
  const costMeter = config.costMeter !== false;

  const usage = new MistralUsage({ ctx, apiKeyEnv, baseURL, currency, barMax, requestTimeoutMs, costMeter, logger });

  const configuredPrices = config.prices !== null && typeof config.prices === "object" ? config.prices : {};

  /**
   * Price lookup, in precedence order: the row config's own `prices`, then the
   * installed pi-ai catalog, then Mistral's published list, then a last-resort
   * default. The source travels with the price so the panel can say which one
   * the estimate rests on.
   * @param {string} model - exact model id.
   * @returns {{ prices: object; source: string }} USD per million tokens and where they came from.
   */
  const priceCache = new Map();
  const pricesFor = (model) => {
    const cached = priceCache.get(model);
    if (cached !== undefined) return cached;
    let resolved;
    const own = configuredPrices[model];
    if (own !== null && typeof own === "object" && Number.isFinite(Number(own.input)) && Number.isFinite(Number(own.output))) {
      resolved = {
        prices: {
          input: Number(own.input),
          output: Number(own.output),
          cacheRead: Number(own.cacheRead ?? 0),
          cacheWrite: Number(own.cacheWrite ?? 0),
        },
        source: "config",
      };
    } else if (catalog?.has(model)) {
      resolved = { prices: catalog.get(model), source: "catalog" };
    } else if (PUBLISHED_PRICES[model] !== undefined) {
      resolved = { prices: PUBLISHED_PRICES[model], source: "published" };
    } else {
      resolved = { prices: UNKNOWN_PRICES, source: "default" };
    }
    priceCache.set(model, resolved);
    return resolved;
  };

  // Load pi-ai's Mistral catalog once, when the package is resolvable. The
  // import is optional: a profile without `llm-pi-ai` still gets the panel.
  let catalog;
  ctx.effect(() => {
    let disposed = false;
    import("@earendil-works/pi-ai/providers/all")
      .then((module) => {
        if (disposed) return;
        const models = module.getBuiltinModels?.("mistral") ?? [];
        const loaded = new Map();
        for (const model of models) {
          const cost = model.cost;
          if (cost === undefined) continue;
          loaded.set(model.id, {
            input: Number(cost.input ?? 0),
            output: Number(cost.output ?? 0),
            cacheRead: Number(cost.cacheRead ?? 0),
            cacheWrite: Number(cost.cacheWrite ?? 0),
          });
        }
        if (loaded.size === 0) return;
        catalog = loaded;
        priceCache.clear();
      })
      .catch(() => {
        /* pi-ai is not installed; the fallback prices apply */
      });
    return () => {
      disposed = true;
    };
  }, "mistral-usage: price catalog");

  // Seed from durable session logs so the figure survives a restart. The
  // cutoff is now: everything older is history, everything newer is counted by
  // the live listener below, so no call is counted twice.
  const activatedAt = Date.now();
  usage.seedPromise = usage
    .seedFromSessionLogs(activatedAt)
    .then((summary) => {
      if (summary !== undefined) {
        logger.info(`mistral-usage: seeded ${summary.calls} historical Mistral calls from ${summary.files} session logs (${summary.scanned} re-read)`);
      }
    })
    .catch((error) => {
      usage.seeded = true;
      logger.warn(`mistral-usage: history seeding failed: ${String(error)}`);
    });

  // Publish the Mistral quota card into `dsh-cost-meter`'s Coding Plan list.
  // That list is a plain object the plugin reads at query time, so adding one
  // entry is enough for the card to appear beside the other plans — the
  // provider id is not a closed enum and the card schema is generic. The
  // query reads the same billing endpoints this bundle's own panel reads.
  if (costMeter) {
    ctx.effect(() => {
      let disposed = false;
      let disposer;
      installCostMeterProvider({ logger })
        .then((installed) => {
          if (disposed) {
            installed?.();
            return;
          }
          disposer = installed;
        })
        .catch((error) => {
          logger.warn(`mistral-usage: could not register the cost-meter provider: ${String(error)}`);
        });
      return () => {
        disposed = true;
        disposer?.();
      };
    }, "mistral-usage: cost-meter provider");
  }

  // Account every Harness request routed to a Mistral route.
  ctx.inject(["llm"], (sctx) => {
    sctx.effect(() => {
      const disposeListener = sctx.on("llm/stream", (options, next) => {
        const provider = String(options?.provider ?? "");
        if (!/^mistral/i.test(provider)) return next();
        const model = String(options?.model ?? "unknown");
        const inner = next();
        return (async function* accounted() {
          for await (const chunk of inner) {
            if (chunk?.type === "usage" && chunk.usage !== undefined) usage.record(model, chunk.usage, Date.now());
            yield chunk;
          }
        })();
      });
      return () => {
        disposeListener();
      };
    }, "mistral-usage: usage accounting");
  });

  // The HTTP bridge the Client half talks to, plus the agent tool.
  ctx.inject(["webServer"], (sctx) => {
    const guard = (req, res) => {
      if (!isBridgeRequestAllowed(req)) {
        writeJson(res, 403, { error: "requests must come from this page's own origin" });
        return false;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { error: `method not allowed: ${req.method ?? ""}` });
        return false;
      }
      return true;
    };
    const routes = [
      {
        kind: "exact",
        path: `${BRIDGE_PREFIX}/summary`,
        handler: async (req, res) => {
          if (!guard(req, res)) return;
          const body = await readJsonBody(req);
          const refresh = body !== null && typeof body === "object" && /** @type {any} */ (body).refresh === true;
          try {
            writeJson(res, 200, await usage.view({ refresh }, pricesFor));
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      },
      {
        kind: "exact",
        path: `${BRIDGE_PREFIX}/key`,
        handler: async (req, res) => {
          if (!guard(req, res)) return;
          const body = await readJsonBody(req);
          if (body === undefined) {
            writeJson(res, 400, { error: "malformed JSON body" });
            return;
          }
          const action = /** @type {any} */ (body)?.action;
          try {
            if (action === "set") {
              const value = /** @type {any} */ (body)?.value;
              if (typeof value !== "string" || value.trim().length === 0) {
                writeJson(res, 400, { error: "a non-empty key is required" });
                return;
              }
              writeJson(res, 200, { ok: true, credential: await usage.setKey(value.trim()) });
              return;
            }
            if (action === "clear") {
              writeJson(res, 200, { ok: true, credential: await usage.clearKey() });
              return;
            }
            writeJson(res, 400, { error: `unknown action: ${String(action)}` });
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      },
    ];
    const disposers = routes.map((route) => sctx.webServer.register(route));
    sctx.effect(() => () => {
      for (const dispose of disposers) dispose();
    }, "mistral-usage: bridge routes");
  });

  ctx.inject(["tools"], (sctx) => {
    sctx.effect(
      () =>
        sctx.tools.register({
          name: "mistral_usage",
          description:
            "Report Mistral API usage for the configured key: the plan and monthly allowance Mistral's billing API returns, and the tokens and estimated cost this Harness itself spent on Mistral models today and in total.",
          parameters: {
            type: "object",
            properties: {
              refresh: { type: "boolean", description: "Re-probe the Mistral billing API instead of using the last answer." },
            },
          },
          output: {
            schema: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
            },
            render: (_args, value) => [{ type: "text", text: String(value?.text ?? "") }],
          },
          async execute(args) {
            const refresh = args !== null && typeof args === "object" && args.refresh === true;
            const view = await usage.view({ refresh }, pricesFor);
            const { consumption, ledger, credential } = view;
            const lines = [];
            if (consumption.status === "ok") {
              lines.push(`Mistral plan: ${consumption.plan ?? "unknown"}`);
              const budget = consumption.api;
              if (budget !== undefined) {
                lines.push(
                  `API budget: ${money(budget.spent, budget.currency ?? currency)} of ${money(budget.limit, budget.currency ?? currency)} used (${budget.percent.toFixed(1)}%)${budget.resetAt !== undefined ? `, resets ${budget.resetAt}` : ""}`,
                );
              }
            } else if (consumption.status === "missing-key") {
              lines.push(`Mistral key ${credential.ref} is not configured.`);
            } else {
              lines.push(`Mistral account figures unavailable (${consumption.status}): ${consumption.message ?? ""}`);
            }
            const today = ledger.today;
            lines.push(
              `This Harness today: ${today.calls} Mistral calls, ${today.input + today.cacheRead + today.cacheWrite} input + ${today.output} output tokens, about ${money(today.cost, "USD")}.`,
            );
            lines.push(`This Harness in total: ${ledger.total.calls} calls, about ${money(ledger.total.cost, "USD")}.`);
            if (today.byModel.length > 0) {
              const top = today.byModel
                .slice(0, 5)
                .map((entry) => `${entry.model} ${entry.input + entry.output + entry.cacheRead + entry.cacheWrite} tok / ${money(entry.cost, "USD")}`)
                .join("; ");
              lines.push(`Today by model: ${top}`);
            }
            return { text: lines.join("\n") };
          },
        }),
      "mistral-usage: tool",
    );
  });
}

// #region cost-meter mirror

/**
 * The `dsh-cost-meter` module that owns the Coding Plan provider table. It is
 * not in that package's `exports` map, so it is resolved from the package
 * directory rather than imported by subpath.
 */
const COST_METER_SUBPATH = ["lib", "coding-plans.js"];
/** The `dsh-cost-meter` package whose provider table this bundle extends. */
const COST_METER_PACKAGE = "dsh-cost-meter";

/**
 * Normalize one billing budget into the cost meter's window shape
 * (`percent` used, `resetsAt` ISO).
 * @param {object | undefined} budget - normalized budget view.
 * @returns {{ percent?: number; resetsAt: string }} the window.
 */
function budgetWindow(budget) {
  if (budget === undefined) return { resetsAt: "" };
  return { percent: Math.max(0, Math.min(100, Math.round(budget.percent * 10) / 10)), resetsAt: budget.resetAt ?? "" };
}

/**
 * Ask Mistral for the API budget in the shape `dsh-cost-meter` renders.
 *
 * `monthly` is the API budget — the money this key actually spends — and
 * `balance` a text row with what is left of it. The Vibe allowance is left out
 * on purpose: it is consumed by Vibe inside its own harness, not by this API
 * key, so showing it beside the API spend would read as money that never moved.
 * @param {string} key - the Mistral API key the cost meter resolved.
 * @param {string} baseURL - Mistral API root.
 * @param {number} timeoutMs - per-request timeout.
 * @returns {Promise<{ windows: Record<string, object>; endpoint: string }>} the quota answer.
 */
async function queryMistralQuota(key, baseURL, timeoutMs) {
  const url = `${baseURL}${BILLING_BUDGET_PATH}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${key.trim()}`, accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 401 || response.status === 403) {
    const error = new Error(`Mistral refused the API key (HTTP ${response.status})`);
    error.soft = true;
    throw error;
  }
  if (!response.ok) throw new Error(`Mistral billing API answered HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Mistral billing answer too large");
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Mistral billing API returned no JSON");
  }
  const record = payload !== null && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
  const api = normalizeBudget(record.api_budget, "api");
  if (api === undefined) throw new Error("Mistral reported no API budget for this key");
  const windows = {
    monthly: budgetWindow(api),
    balance: { resetsAt: "", text: money(Math.max(0, api.limit - api.spent), api.currency ?? "EUR") },
  };
  return { windows, endpoint: url };
}

/**
 * Locate the installed `dsh-cost-meter`'s Coding Plan module.
 *
 * The profile's `node_modules` is on this process's resolution path, so the
 * package's own `package.json` anchors its sibling `lib/` directory.
 * @returns {Promise<string | undefined>} the module file URL, or undefined when the plugin is absent.
 */
async function resolveCostMeterModule() {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const profile = process.env.DSH_PROFILE ?? "desktop";
  const anchor = path.join(dshHome(), "profiles", profile, "package.json");
  const require = createRequire(fs.existsSync(anchor) ? anchor : path.join(dshHome(), "package.json"));
  const packageJson = require.resolve(`${COST_METER_PACKAGE}/package.json`);
  const file = path.join(path.dirname(packageJson), ...COST_METER_SUBPATH);
  if (!fs.existsSync(file)) return undefined;
  return pathToFileURL(file).href;
}

/**
 * Add the `mistral` provider to the installed `dsh-cost-meter`'s Coding Plan
 * table, so its quota card renders this allowance beside the other plans.
 *
 * `CODING_PLAN_PROVIDERS` is a plain object the cost meter reads at query time
 * (it is not frozen and the provider id is not a closed enum), so one entry is
 * enough for the card to appear — with the same enable switch, display
 * position and refresh interval as every other plan. The card's `windows` are
 * filled from `queryMistralQuota` through the `quota` hook below, which the
 * cost meter's generic branch reaches by calling the entry's own query.
 *
 * Nothing is patched on disk: the entry lives in this process and is removed
 * when the plugin unloads.
 * @param {{ logger: object }} options - logging seam.
 * @returns {Promise<(() => void) | undefined>} a disposer, or undefined when the cost meter is absent.
 */
async function installCostMeterProvider({ logger }) {
  const url = await resolveCostMeterModule();
  if (url === undefined) return undefined;
  const module = await import(url);
  const providers = module.CODING_PLAN_PROVIDERS;
  if (providers === null || typeof providers !== "object") {
    logger.warn("mistral-usage: dsh-cost-meter exposes no Coding Plan table; the mirror is skipped");
    return undefined;
  }
  const saved = providers[COST_METER_PROVIDER];
  providers[COST_METER_PROVIDER] = {
    label: "Mistral",
    credentialEnvs: [DEFAULT_API_KEY_ENV],
    keyHint: "Mistral API key (the same key the llm-pi-ai Mistral route uses); shows the monthly Vibe allowance and API budget",
    /** Quota hook read by the cost meter's generic branch. */
    quota: (key, options) => queryMistralQuota(key, DEFAULT_BASE_URL, options?.timeoutMs ?? 15_000),
  };
  // The id list is a snapshot taken when that module loaded, and the cost
  // meter iterates it to build the cards, so the new id has to join it too.
  const ids = module.CODING_PLAN_PROVIDER_IDS;
  const added = Array.isArray(ids) && !ids.includes(COST_METER_PROVIDER);
  if (added) ids.push(COST_METER_PROVIDER);
  logger.info?.('mistral-usage: registered the "Mistral" quota card with dsh-cost-meter');
  return () => {
    if (saved === undefined) delete providers[COST_METER_PROVIDER];
    else providers[COST_METER_PROVIDER] = saved;
    if (added && Array.isArray(ids)) {
      const at = ids.indexOf(COST_METER_PROVIDER);
      if (at >= 0) ids.splice(at, 1);
    }
  };
}

// #endregion

/**
 * Optional services only: the panel still activates without a web server or
 * tools, and each `ctx.inject` block joins when its service arrives.
 */
export const inject = [];

/** Internals for the packaging check; the Loader ignores extra exports. */
export const __test = {
  BRIDGE_PREFIX,
  COST_METER_PROVIDER,
  normalizeBudget,
  normalizeBilling,
  refusalReason,
  dayKey,
  foldSession,
  mergeDays,
  queryMistralQuota,
  installCostMeterProvider,
  resolveCostMeterModule,
  pricesFor: PUBLISHED_PRICES,
  MistralUsage,
};
