/**
 * System prompt and tool schema for the trade-decision LLM call.
 *
 * We force the model to answer through a single tool ("record_trade_decision")
 * whose input schema *is* the TradeDecision shape. Forcing a tool call is the
 * most reliable way to get strict, parseable JSON out of the Messages API — the
 * SDK validates tool_use against the schema, and we JSON.parse the input
 * (never string-match). The system prompt pins behavior: cite only the given
 * numbers, never fabricate data, and hold when the snapshot is degraded.
 */
import type { MarketSnapshot } from "../types.js";
import { TOKEN_SYMBOLS } from "../tokens.js";

export const DECISION_TOOL_NAME = "record_trade_decision";

/** JSON Schema for the forced tool call. Mirrors TradeDecision exactly. */
export const decisionToolSchema = {
  type: "object" as const,
  properties: {
    action: {
      type: "string",
      enum: ["swap", "hold"],
      description: "Whether to propose a swap now, or hold.",
    },
    tokenIn: {
      type: "string",
      enum: ["", ...TOKEN_SYMBOLS],
      description: "Symbol to sell. Empty string when action is hold.",
    },
    tokenOut: {
      type: "string",
      enum: ["", ...TOKEN_SYMBOLS],
      description: "Symbol to buy. Empty string when action is hold.",
    },
    amountUSD: {
      type: "number",
      minimum: 0,
      description:
        "Proposed trade notional in US dollars (whole dollars). 0 when holding.",
    },
    reasoning: {
      type: "string",
      description:
        "2 to 4 plain-English sentences that justify the decision using ONLY the market data and portfolio provided. No jargon, no invented figures.",
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "How strongly the data supports this decision.",
    },
  },
  required: ["action", "tokenIn", "tokenOut", "amountUSD", "reasoning", "confidence"],
  additionalProperties: false,
};

export const SYSTEM_PROMPT = `You are Sable, a cautious AI trading co-pilot for a non-custodial vault on the X Layer network. The user holds a small portfolio of three tokens: OKB, USDC, and WETH. USDC is a stable "cash" leg worth about $1; OKB and WETH are volatile.

Your job: read the user's message, their current vault balances, and a live market snapshot, then decide whether to propose ONE swap between two of the supported tokens, or to hold.

Hard rules — follow every one:
1. Recommend swaps ONLY between OKB, USDC, and WETH. Never mention or propose any other asset.
2. Base every claim strictly on the numbers you are given (prices, 24h change, balances). NEVER invent prices, percentages, news, or events. If you cite a number, it must appear in the provided data.
3. If the market snapshot is marked degraded/unavailable, you MUST hold and say prices are temporarily unavailable.
4. Only propose a swap the user can afford: amountUSD must not exceed the USD value of their balance of tokenIn.
5. Size trades conservatively. Prefer partial rebalances over "all-in" moves. When uncertain, hold.
6. tokenIn and tokenOut must differ and both must be in {OKB, USDC, WETH}. For a hold, set tokenIn and tokenOut to "" and amountUSD to 0.
7. reasoning must be 2–4 short, plain sentences a beginner can follow. State what the data shows and why it leads to your decision.
8. Do NOT promise profits or give financial guarantees. This is a suggestion the user will review and approve.

You must answer by calling the ${DECISION_TOOL_NAME} tool exactly once. Do not write any prose outside the tool call.`;

/**
 * Build the user-turn content: portfolio + market data as compact, unambiguous
 * text. Everything the model is allowed to cite lives here.
 */
export function buildUserMessage(params: {
  userMessage: string;
  balancesUSD: Record<string, number>;
  market: MarketSnapshot;
  availableTodayUSD: number;
}): string {
  const { userMessage, balancesUSD, market, availableTodayUSD } = params;

  const priceLines = TOKEN_SYMBOLS.map((s) => {
    const p = market.prices[s];
    const chg = p.change24hPct;
    const sign = chg >= 0 ? "+" : "";
    return `- ${s}: $${p.usd} (24h ${sign}${chg.toFixed(2)}%)`;
  }).join("\n");

  const balanceLines = TOKEN_SYMBOLS.map((s) => {
    const usd = balancesUSD[s] ?? 0;
    return `- ${s}: ~$${usd.toFixed(2)}`;
  }).join("\n");

  return `User says: "${userMessage}"

Current vault balances (approx USD value):
${balanceLines}

Live market snapshot${market.degraded ? " (DEGRADED — prices unavailable, you must hold)" : ""} taken ${market.fetchedAt}:
${priceLines}

Risk budget: the agent may spend at most $${availableTodayUSD.toFixed(2)} more on the user's behalf today (an on-chain daily cap the user set). Do not propose a swap larger than this; if the ideal trade is bigger, size it to fit or hold.

Decide now by calling ${DECISION_TOOL_NAME}.`;
}
