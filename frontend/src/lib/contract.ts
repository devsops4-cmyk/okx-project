/**
 * SableVault contract bindings for the frontend. The user's wallet directly
 * calls the "self-service" methods here — deposit, withdraw, and setRiskLimit —
 * so risk limits are set by the user's own signature, never by the agent. The
 * agent-only executeSwap is intentionally NOT exposed to the UI.
 *
 * ABI is a hand-written subset matching contracts/SableVault.sol.
 */
export const VAULT_ADDRESS = ((import.meta.env.VITE_SABLE_VAULT_ADDRESS || "").trim() ||
  undefined) as `0x${string}` | undefined;

/** USD notional is stored on-chain with 8 decimals (USD_DECIMALS). */
export const USD_DECIMALS = 8;

export const SABLE_VAULT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setRiskLimit",
    stateMutability: "nonpayable",
    inputs: [{ name: "maxDailyNotionalUSD", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "availableDailyNotional",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "riskLimits",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "maxDailyNotionalUSD", type: "uint256" },
      { name: "spentTodayUSD", type: "uint256" },
      { name: "currentDay", type: "uint256" },
    ],
  },
] as const;

/** Minimal ERC-20 ABI for approve/allowance/balance used by the deposit flow. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
