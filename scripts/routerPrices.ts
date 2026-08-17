import type { Contract } from "ethers";

/**
 * Seed a MockRouter's per-token USD prices from the *same* source the agent
 * prices against (CoinGecko), so an agent-sized swap clears the on-chain
 * slippage floor instead of reverting on a price/decimal mismatch. Shared by
 * deployRouter.ts (router-only redeploy) and deployMocks.ts (full mock stack).
 *
 * The router stores prices in 8-decimal USD fixed point (1e8 == $1.00) and does
 * the decimal correction itself, so we only pass whole-token USD prices here.
 */

// Symbol -> CoinGecko id. Must match agent/src/tokens.ts exactly.
export const COINGECKO_IDS = {
  OKB: "okb",
  USDC: "usd-coin",
  WETH: "ethereum",
} as const;

export type SeedSymbol = keyof typeof COINGECKO_IDS;

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/** Fetch live USD spot for the given CoinGecko ids. Throws on any failure. */
export async function fetchUsdPrices(ids: string[]): Promise<Record<string, number>> {
  const params = new URLSearchParams({ ids: ids.join(","), vs_currencies: "usd" });
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  }

  const res = await fetch(`${COINGECKO_BASE}/simple/price?${params.toString()}`, { headers });
  if (!res.ok) {
    throw new Error(`CoinGecko responded ${res.status} while fetching seed prices`);
  }
  const body = (await res.json()) as Record<string, { usd?: number }>;

  const out: Record<string, number> = {};
  for (const id of ids) {
    const usd = body[id]?.usd;
    if (typeof usd !== "number" || !(usd > 0)) {
      throw new Error(`CoinGecko returned no USD price for "${id}"`);
    }
    out[id] = usd;
  }
  return out;
}

/**
 * Set prices on `router` for the provided tokens. `tokens` maps each supported
 * symbol to its on-chain address. Returns the USD prices used (for logging).
 */
export async function seedRouterPrices(
  router: Contract,
  tokens: Partial<Record<SeedSymbol, string>>,
): Promise<Record<string, number>> {
  const entries = (Object.keys(tokens) as SeedSymbol[])
    .filter((sym) => (tokens[sym] ?? "").length > 0)
    .map((sym) => ({ sym, address: tokens[sym]!, id: COINGECKO_IDS[sym] }));

  if (entries.length === 0) {
    throw new Error("seedRouterPrices: no token addresses provided");
  }

  const prices = await fetchUsdPrices(entries.map((e) => e.id));

  const addresses = entries.map((e) => e.address);
  // 8-decimal USD fixed point: $1900.12 -> 190012000000.
  const priceUnits = entries.map((e) => BigInt(Math.round(prices[e.id] * 1e8)));

  const tx = await router.setTokenPrices(addresses, priceUnits);
  await tx.wait();

  const used: Record<string, number> = {};
  for (const e of entries) used[e.sym] = prices[e.id];
  return used;
}
