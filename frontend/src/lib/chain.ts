/**
 * X Layer chain definitions for wagmi/viem. We define both mainnet (196) and a
 * configurable testnet so the app can target either via env. The testnet chain
 * ID is read from VITE_XLAYER_CHAIN_ID because OKX docs and aggregators disagree
 * (1952 vs 195) — see the contracts package for the same note.
 */
import { defineChain } from "viem";

const RPC = import.meta.env.VITE_XLAYER_RPC_URL || "https://rpc.xlayer.tech";
const CHAIN_ID = Number(import.meta.env.VITE_XLAYER_CHAIN_ID || 196);

export const xLayer = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 196 ? "X Layer" : "X Layer (testnet)",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC] },
    public: { http: [RPC] },
  },
  blockExplorers: {
    default: {
      name: "OKLink",
      url:
        CHAIN_ID === 196
          ? "https://www.oklink.com/xlayer"
          : "https://www.oklink.com/x-layer-testnet",
    },
  },
  testnet: CHAIN_ID !== 196,
});

export const ACTIVE_CHAIN_ID = CHAIN_ID;
