/**
 * Typed client for the Sable agent backend. Mirrors the API's response shapes
 * (kept in sync with agent/src/types.ts). Uses relative URLs so the Vite dev
 * proxy handles routing; in production set VITE_AGENT_API_URL.
 */
const BASE = import.meta.env.VITE_AGENT_API_URL || "";

export type Confidence = "low" | "medium" | "high";
export type Action = "swap" | "hold";

export interface TradeDecision {
  action: Action;
  tokenIn: string;
  tokenOut: string;
  amountUSD: number;
  reasoning: string;
  confidence: Confidence;
}

export interface TokenPrice {
  symbol: string;
  usd: number;
  change24hPct: number;
}

export interface MarketSnapshot {
  prices: Record<string, TokenPrice>;
  fetchedAt: string;
  degraded: boolean;
}

export interface RiskLimitState {
  maxDailyNotionalUSD: number;
  availableTodayUSD: number;
}

export interface RiskCheck {
  ok: boolean;
  limit: RiskLimitState;
  reason?: string;
}

export interface AdviceResult {
  decision: TradeDecision;
  proposal: TradeDecision;
  riskCheck: RiskCheck;
  market: MarketSnapshot;
}

export interface PortfolioResponse {
  address: string;
  balances: Record<string, { raw: string; human: string; usd: number }>;
  riskLimit: RiskLimitState;
  market: MarketSnapshot;
}

export interface ExecuteResult {
  txHash: string;
  amountIn: string;
  minAmountOut: string;
  simulated: boolean;
  mode: "mock" | "live";
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  kind: "advice" | "execution";
  userMessage?: string;
  advice?: AdviceResult;
  execution?: {
    txHash: string;
    tokenIn: string;
    tokenOut: string;
    amountUSD: number;
    amountIn: string;
    minAmountOut: string;
    simulated: boolean;
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    // fetch() rejects with a TypeError only on network-level failures — the
    // agent backend isn't running, the URL is wrong, or CORS blocked it. Turn
    // the browser's opaque "Failed to fetch" into something actionable.
    throw new Error(
      `Can't reach the agent backend${BASE ? ` at ${BASE}` : ""}. Is it running? ` +
        "Start it with `cd agent && npm run dev` (or `npm run dev` at the repo root to launch both servers).",
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  health: () =>
    req<{ ok: boolean; mode: string; model: string; chainId: number; liveChain: boolean }>(
      "/api/health",
    ),
  market: () => req<MarketSnapshot>("/api/market"),
  portfolio: (address: string) => req<PortfolioResponse>(`/api/portfolio/${address}`),
  advise: (address: string, message: string) =>
    req<AdviceResult>("/api/advise", {
      method: "POST",
      body: JSON.stringify({ address, message }),
    }),
  execute: (address: string, tokenIn: string, tokenOut: string, amountUSD: number) =>
    req<ExecuteResult>("/api/execute", {
      method: "POST",
      body: JSON.stringify({ address, tokenIn, tokenOut, amountUSD }),
    }),
  history: (address: string) =>
    req<{ address: string; history: HistoryEntry[] }>(`/api/history/${address}`),
};
