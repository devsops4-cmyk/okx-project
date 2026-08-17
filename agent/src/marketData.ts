/**
 * Market data via CoinGecko's simple/price endpoint. We fetch USD spot + 24h
 * change for the three supported tokens in a single request. If the call fails
 * (rate limit, network, outage), we fall back to the last good snapshot and
 * flag the result `degraded: true` so the agent can say so rather than invent
 * numbers — the spec forbids fabricating market data.
 */
import { config } from "./config.js";
import { TOKENS, TOKEN_SYMBOLS, type TokenSymbol } from "./tokens.js";
import type { MarketSnapshot, TokenPrice } from "./types.js";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/** Last successful snapshot, reused if a later fetch fails. */
let lastGood: MarketSnapshot | undefined;

interface CoinGeckoSimplePrice {
  [coinId: string]: { usd?: number; usd_24h_change?: number };
}

function coingeckoUrl(): string {
  const ids = TOKEN_SYMBOLS.map((s) => TOKENS[s].coingeckoId).join(",");
  const params = new URLSearchParams({
    ids,
    vs_currencies: "usd",
    include_24hr_change: "true",
  });
  return `${COINGECKO_BASE}/simple/price?${params.toString()}`;
}

function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  // Demo/pro key is optional; header name is the same for the demo tier.
  if (config.coingeckoApiKey) {
    headers["x-cg-demo-api-key"] = config.coingeckoApiKey;
  }
  return headers;
}

/**
 * Fetch a fresh market snapshot. Never throws for the common failure modes —
 * returns a degraded snapshot backed by the last good data (or a neutral
 * stablecoin-anchored fallback on a cold start) so the API stays responsive.
 */
export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(coingeckoUrl(), {
      headers: requestHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`CoinGecko responded ${res.status}`);
    }

    const body = (await res.json()) as CoinGeckoSimplePrice;
    const prices = {} as Record<TokenSymbol, TokenPrice>;

    for (const symbol of TOKEN_SYMBOLS) {
      const node = body[TOKENS[symbol].coingeckoId];
      if (!node || typeof node.usd !== "number") {
        throw new Error(`Missing price for ${symbol}`);
      }
      prices[symbol] = {
        symbol,
        usd: node.usd,
        change24hPct: typeof node.usd_24h_change === "number" ? node.usd_24h_change : 0,
      };
    }

    const snapshot: MarketSnapshot = {
      prices,
      fetchedAt: new Date().toISOString(),
      degraded: false,
    };
    lastGood = snapshot;
    return snapshot;
  } catch (err) {
    console.warn(
      `[marketData] live fetch failed (${(err as Error).message}); serving ${
        lastGood ? "last good snapshot" : "cold fallback"
      }.`,
    );
    return degradedSnapshot();
  }
}

/**
 * Serve the most recent good data, marked degraded. On a cold start with no
 * cached data we anchor USDC at $1 and mark the others as unknown (0) — the
 * prompt tells the model to treat a degraded snapshot as "prices unavailable"
 * and recommend holding.
 */
function degradedSnapshot(): MarketSnapshot {
  if (lastGood) {
    return { ...lastGood, degraded: true };
  }
  const prices = {} as Record<TokenSymbol, TokenPrice>;
  for (const symbol of TOKEN_SYMBOLS) {
    prices[symbol] = {
      symbol,
      usd: symbol === "USDC" ? 1 : 0,
      change24hPct: 0,
    };
  }
  return { prices, fetchedAt: new Date().toISOString(), degraded: true };
}
