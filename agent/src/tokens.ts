/**
 * Shared token registry and typed config for the Sable agent.
 *
 * The three tokens the product supports (per build spec): OKB (X Layer gas
 * token, wrapped for ERC-20 swaps), USDC (the stable leg), and WETH (bridged
 * ETH). Addresses are read from env so the same code runs against testnet and
 * mainnet — the deploy step fills these in. We keep CoinGecko ids alongside so
 * marketData.ts can price them without a second lookup table.
 */
import "dotenv/config";

export type TokenSymbol = "OKB" | "USDC" | "WETH";

export interface TokenInfo {
  symbol: TokenSymbol;
  /** On-chain ERC-20 address on the active X Layer network. */
  address: string;
  decimals: number;
  /** CoinGecko coin id used for USD pricing. */
  coingeckoId: string;
  /** Human label shown in agent reasoning / UI. */
  label: string;
}

/**
 * The token set is fixed (spec: "ETH, OKB, USDC" — WETH is the ERC-20 form of
 * ETH used for on-chain swaps). Decimals are the canonical values for these
 * assets; addresses come from env and may be empty until deploy.
 */
export const TOKENS: Record<TokenSymbol, TokenInfo> = {
  OKB: {
    symbol: "OKB",
    address: (process.env.TOKEN_OKB_ADDRESS ?? "").trim(),
    decimals: 18,
    coingeckoId: "okb",
    label: "OKB",
  },
  USDC: {
    symbol: "USDC",
    address: (process.env.TOKEN_USDC_ADDRESS ?? "").trim(),
    decimals: 6,
    coingeckoId: "usd-coin",
    label: "USD Coin",
  },
  WETH: {
    symbol: "WETH",
    address: (process.env.TOKEN_WETH_ADDRESS ?? "").trim(),
    decimals: 18,
    coingeckoId: "ethereum",
    label: "Ether (wrapped)",
  },
};

export const TOKEN_SYMBOLS = Object.keys(TOKENS) as TokenSymbol[];

/** Look up a token by symbol, throwing a clear error on an unknown symbol. */
export function getToken(symbol: string): TokenInfo {
  const key = symbol.toUpperCase() as TokenSymbol;
  const info = TOKENS[key];
  if (!info) {
    throw new Error(
      `Unknown token "${symbol}". Supported: ${TOKEN_SYMBOLS.join(", ")}.`,
    );
  }
  return info;
}

/** Resolve a token by its on-chain address (case-insensitive). */
export function getTokenByAddress(address: string): TokenInfo | undefined {
  const target = address.toLowerCase();
  return Object.values(TOKENS).find((t) => t.address.toLowerCase() === target);
}
