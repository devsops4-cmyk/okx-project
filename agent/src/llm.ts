/**
 * Anthropic-backed trade decision. We call the Messages API with a single tool
 * and force the model to use it (tool_choice), which yields schema-validated
 * JSON we can JSON.parse directly from the tool_use block — the robust way to
 * get strict structured output. Model defaults to claude-opus-5 (spec: latest,
 * most capable Claude), overridable via ANTHROPIC_MODEL.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config, assertAnthropicKey } from "./config.js";
import {
  SYSTEM_PROMPT,
  DECISION_TOOL_NAME,
  decisionToolSchema,
  buildUserMessage,
} from "./prompts/tradeDecision.js";
import { TOKEN_SYMBOLS, type TokenSymbol } from "./tokens.js";
import type { MarketSnapshot, TradeDecision } from "./types.js";

let client: Anthropic | undefined;

/**
 * Thrown when the Claude provider rate-limits us (HTTP 429). Carries an optional
 * `retryAfterSec` from the response so the API can echo it in a `Retry-After`
 * header. The server maps this to a 429 (not a 500) with a human message, so the
 * chat shows "wait a moment" instead of a raw gateway JSON blob.
 */
export class LlmRateLimitError extends Error {
  readonly retryAfterSec?: number;
  constructor(message: string, retryAfterSec?: number) {
    super(message);
    this.name = "LlmRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/** Pull a `retry-after` (seconds) from an SDK error's headers, if present. */
function retryAfterSeconds(err: unknown): number | undefined {
  const headers = (err as { headers?: unknown }).headers;
  if (!headers) return undefined;
  let raw: string | null | undefined;
  if (typeof (headers as Headers).get === "function") {
    raw = (headers as Headers).get("retry-after");
  } else {
    raw = (headers as Record<string, string>)["retry-after"];
  }
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Some Claude gateways (AgentRouter) return a valid Anthropic JSON body tagged
 * `Content-Type: text/plain`, which the SDK will not parse — it hands back the
 * raw string instead of a Message. This shim rewrites that one header to
 * application/json when the body is clearly JSON, leaving streaming responses
 * (event-stream) and genuinely non-JSON bodies untouched.
 */
const gatewayFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || ct.includes("json") || ct.includes("event-stream")) {
    return res;
  }
  const text = await res.text();
  const headers = new Headers(res.headers);
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    headers.set("content-type", "application/json");
  }
  return new Response(text, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};

function getClient(): Anthropic {
  assertAnthropicKey();
  if (client) return client;

  if (config.anthropicBaseUrl) {
    // Third-party gateway: authenticate with a Bearer token (not x-api-key),
    // present a claude-cli User-Agent (the gateway fingerprints the client),
    // and repair the response content-type via gatewayFetch.
    //
    // maxRetries: 0 — the SDK retries 429/5xx up to 2x by default. Against a
    // tight-ceiling reseller gateway that turns one throttled send into three
    // hits (burning the budget faster) and stalls the UI on backoff. We'd rather
    // fail fast and tell the user to wait a beat (see getTradeDecision).
    client = new Anthropic({
      apiKey: null,
      authToken: config.anthropicApiKey,
      baseURL: config.anthropicBaseUrl,
      defaultHeaders: { "User-Agent": config.anthropicUserAgent },
      fetch: gatewayFetch,
      maxRetries: 0,
    });
  } else {
    // First-party api.anthropic.com — standard x-api-key auth.
    client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
  }
  return client;
}

export interface DecisionInput {
  userMessage: string;
  balancesUSD: Record<string, number>;
  market: MarketSnapshot;
  availableTodayUSD: number;
}

/**
 * Ask Claude for a trade decision. Returns the model's raw proposal — the
 * on-chain risk check is applied separately (riskLimits.ts) so the two concerns
 * stay independent and testable.
 */
export async function getTradeDecision(input: DecisionInput): Promise<TradeDecision> {
  const anthropic = getClient();

  const userMessage = buildUserMessage(input);

  let response;
  try {
    response = await anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      // Force the model to answer through the schema-validated tool.
      tools: [
        {
          name: DECISION_TOOL_NAME,
          description:
            "Record the trade decision as strict JSON. Call exactly once.",
          input_schema: decisionToolSchema,
        },
      ],
      tool_choice: { type: "tool", name: DECISION_TOOL_NAME },
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    // The provider (or the AgentRouter gateway in front of it) throttled us.
    // Surface a friendly, actionable message the chat can show verbatim instead
    // of leaking the raw gateway JSON error to the user.
    if (err instanceof Anthropic.RateLimitError || (err as { status?: number })?.status === 429) {
      const retryAfterSec = retryAfterSeconds(err);
      const wait = retryAfterSec ? `about ${retryAfterSec}s` : "a moment";
      throw new LlmRateLimitError(
        `The AI provider is rate-limited right now. Please wait ${wait} and try again.`,
        retryAfterSec,
      );
    }
    throw err;
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === DECISION_TOOL_NAME,
  );

  if (!toolUse) {
    throw new Error("Model did not return a trade decision tool call.");
  }

  // tool_use.input is already parsed JSON validated against our schema.
  return normalizeDecision(toolUse.input as Record<string, unknown>);
}

/**
 * Defensive normalization. The schema constrains the model, but we still coerce
 * to our exact TradeDecision type and enforce the invariants the contract cares
 * about (hold => empty legs, distinct tokens) so a malformed decision can never
 * reach the swap path.
 */
function normalizeDecision(raw: Record<string, unknown>): TradeDecision {
  const action = raw.action === "swap" ? "swap" : "hold";
  const confidence =
    raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low";
  const reasoning =
    typeof raw.reasoning === "string" && raw.reasoning.trim()
      ? raw.reasoning.trim()
      : "No reasoning provided.";

  if (action === "hold") {
    return { action: "hold", tokenIn: "", tokenOut: "", amountUSD: 0, reasoning, confidence };
  }

  const tokenIn = asSymbol(raw.tokenIn);
  const tokenOut = asSymbol(raw.tokenOut);
  const amountUSD =
    typeof raw.amountUSD === "number" && Number.isFinite(raw.amountUSD)
      ? Math.max(0, raw.amountUSD)
      : 0;

  // A swap must have two distinct valid legs and a positive size; otherwise the
  // model contradicted itself — treat it as a hold rather than trust it.
  if (!tokenIn || !tokenOut || tokenIn === tokenOut || amountUSD <= 0) {
    return {
      action: "hold",
      tokenIn: "",
      tokenOut: "",
      amountUSD: 0,
      reasoning:
        reasoning +
        " (Held: the proposed swap was incomplete or inconsistent, so no trade was made.)",
      confidence: "low",
    };
  }

  return { action: "swap", tokenIn, tokenOut, amountUSD, reasoning, confidence };
}

function asSymbol(v: unknown): TokenSymbol | "" {
  if (typeof v === "string" && (TOKEN_SYMBOLS as string[]).includes(v)) {
    return v as TokenSymbol;
  }
  return "";
}
