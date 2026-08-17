/**
 * Token registry for the frontend. Symbols map to on-chain addresses (from env)
 * and decimals. These MUST match the addresses the agent backend uses so that a
 * swap the agent proposes references the same tokens the user deposited.
 */
export type TokenSymbol = "OKB" | "USDC" | "WETH";

export interface TokenInfo {
  symbol: TokenSymbol;
  address: `0x${string}`;
  decimals: number;
  label: string;
}

const A = (v: string | undefined) => ((v || "").trim() as `0x${string}`);

export const TOKENS: Record<TokenSymbol, TokenInfo> = {
  OKB: {
    symbol: "OKB",
    address: A(import.meta.env.VITE_TOKEN_OKB_ADDRESS),
    decimals: 18,
    label: "OKB",
  },
  USDC: {
    symbol: "USDC",
    address: A(import.meta.env.VITE_TOKEN_USDC_ADDRESS),
    decimals: 6,
    label: "USDC",
  },
  WETH: {
    symbol: "WETH",
    address: A(import.meta.env.VITE_TOKEN_WETH_ADDRESS),
    decimals: 18,
    label: "WETH",
  },
};

export const TOKEN_LIST = Object.values(TOKENS);

export function tokenBySymbol(symbol: string): TokenInfo | undefined {
  return TOKENS[symbol as TokenSymbol];
}
