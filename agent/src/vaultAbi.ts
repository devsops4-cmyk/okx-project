/**
 * Minimal ABI for the parts of SableVault the agent backend touches. Kept as a
 * hand-written const (not imported from the Hardhat artifact) so the agent
 * package has no build-time dependency on the contracts package — the two can
 * be deployed independently. Signatures mirror contracts/SableVault.sol.
 */
export const SABLE_VAULT_ABI = [
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
  {
    type: "function",
    name: "executeSwap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "amountInUSD", type: "uint256" },
      { name: "router", type: "address" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "event",
    name: "SwapExecuted",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "tokenIn", type: "address", indexed: true },
      { name: "tokenOut", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "amountInUSD", type: "uint256", indexed: false },
      { name: "router", type: "address", indexed: false },
    ],
  },
] as const;

/** The vault stores USD notional with 8 decimals (USD_DECIMALS constant). */
export const USD_DECIMALS = 8;
