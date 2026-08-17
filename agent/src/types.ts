/**
 * Shared types across the agent backend. Kept in one file so the LLM decision
 * shape, the risk-check result, and the API responses stay in lockstep — the
 * frontend consumes these same shapes.
 */
import type { TokenSymbol } from "./tokens.js";

export type Confidence = "low" | "medium" | "high";
export type Action = "swap" | "hold";

/**
 * The strict-JSON object the model is required to produce. This is the *raw*
 * proposal, before any on-chain risk check has been applied.
 */
export interface TradeDecision {
  action: Action;
  /** Symbol to sell. For a hold this is the empty string. */
  tokenIn: TokenSymbol | "";
  /** Symbol to buy. For a hold this is the empty string. */
  tokenOut: TokenSymbol | "";
  /** Proposed notional in USD. For a hold this is 0. */
  amountUSD: number;
  /** 2–4 plain-English sentences citing the provided market data. */
  reasoning: string;
  confidence: Confidence;
}

export interface TokenPrice {
  symbol: TokenSymbol;
  usd: number;
  change24hPct: number;
}

export interface MarketSnapshot {
  prices: Record<TokenSymbol, TokenPrice>;
  /** ISO timestamp the snapshot was fetched. */
  fetchedAt: string;
  /** True when live prices were unavailable and cached/fallback data was used. */
  degraded: boolean;
}

export interface RiskLimitState {
  /** User's configured daily cap in whole USD (0 = agent trading disabled). */
  maxDailyNotionalUSD: number;
  /** Remaining USD the agent may still spend on the user's behalf today. */
  availableTodayUSD: number;
}

export interface RiskCheck {
  /** Whether the proposed swap passes the on-chain daily cap. */
  ok: boolean;
  limit: RiskLimitState;
  /** Present when the proposal was downgraded to a hold. */
  reason?: string;
}

/** The advise endpoint's response: decision after risk enforcement + context. */
export interface AdviceResult {
  /** Decision actually returned to the user (may be a downgraded hold). */
  decision: TradeDecision;
  /** The model's original proposal, before the risk check. */
  proposal: TradeDecision;
  riskCheck: RiskCheck;
  market: MarketSnapshot;
}
