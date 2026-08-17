/**
 * Vault access layer with two interchangeable implementations behind one
 * interface:
 *
 *   - MockVaultClient — in-memory state, used by default so the whole agent +
 *     frontend flow works before any contract is deployed (spec build-step 3:
 *     "mocked contract calls first").
 *   - LiveVaultClient — talks to the deployed SableVault over viem, using the
 *     agent signer key (spec build-step 5: "connect agent to real deployed
 *     contract").
 *
 * The server picks one via isLiveChain() at boot; nothing else changes.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  getAddress,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { getToken, TOKEN_SYMBOLS, type TokenSymbol } from "./tokens.js";
import { SABLE_VAULT_ABI, USD_DECIMALS } from "./vaultAbi.js";
import type { MarketSnapshot, RiskLimitState } from "./types.js";

export interface SwapRequest {
  user: string;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountUSD: number;
  market: MarketSnapshot;
}

export interface SwapResult {
  txHash: string;
  amountIn: string; // human-readable, tokenIn units
  minAmountOut: string; // human-readable, tokenOut units
  simulated: boolean; // true in mock mode
}

export interface VaultClient {
  readonly mode: "mock" | "live";
  /** Per-token vault balances for a user, keyed by symbol (raw base units as string). */
  getBalances(user: string): Promise<Record<TokenSymbol, bigint>>;
  /** The user's daily risk-limit state, in whole USD. */
  getRiskLimit(user: string): Promise<RiskLimitState>;
  /** Execute a swap through the vault, returning a tx hash. */
  executeSwap(req: SwapRequest): Promise<SwapResult>;
}

// ── Trade math shared by both implementations ────────────────────────────────

/** Convert a USD notional into a tokenIn base-unit amount using snapshot price. */
export function usdToTokenAmount(
  symbol: TokenSymbol,
  amountUSD: number,
  market: MarketSnapshot,
): bigint {
  const price = market.prices[symbol]?.usd ?? 0;
  if (price <= 0) throw new Error(`No price for ${symbol}; cannot size trade.`);
  const tokens = amountUSD / price;
  return parseUnits(tokens.toFixed(getToken(symbol).decimals), getToken(symbol).decimals);
}

/** Expected tokenOut for a given USD notional, minus slippage, in base units. */
export function minAmountOut(
  symbol: TokenSymbol,
  amountUSD: number,
  market: MarketSnapshot,
): bigint {
  const price = market.prices[symbol]?.usd ?? 0;
  if (price <= 0) throw new Error(`No price for ${symbol}; cannot size trade.`);
  const expected = amountUSD / price;
  const afterSlippage = expected * (1 - config.slippageBps / 10_000);
  return parseUnits(
    afterSlippage.toFixed(getToken(symbol).decimals),
    getToken(symbol).decimals,
  );
}

/** USD notional -> vault's 8-decimal fixed-point representation. */
export function usdToVaultUnits(amountUSD: number): bigint {
  return parseUnits(amountUSD.toFixed(USD_DECIMALS), USD_DECIMALS);
}

// ── Mock implementation ──────────────────────────────────────────────────────

/**
 * In-memory vault used until a real contract is wired up. Seeds each new user
 * with a demo portfolio and a $500/day risk cap so the end-to-end flow is
 * demonstrable without on-chain deposits. State is per-process (resets on
 * restart) — appropriate for local dev and the mocked build phase only.
 */
export class MockVaultClient implements VaultClient {
  readonly mode = "mock" as const;
  private balances = new Map<string, Record<TokenSymbol, bigint>>();
  private caps = new Map<string, { maxUSD: number; spentUSD: number }>();

  private seed(user: string): void {
    const key = user.toLowerCase();
    if (!this.balances.has(key)) {
      this.balances.set(key, {
        OKB: parseUnits("50", getToken("OKB").decimals), // ~demo holding
        USDC: parseUnits("1000", getToken("USDC").decimals),
        WETH: parseUnits("0.25", getToken("WETH").decimals),
      });
    }
    if (!this.caps.has(key)) {
      this.caps.set(key, { maxUSD: 500, spentUSD: 0 });
    }
  }

  async getBalances(user: string): Promise<Record<TokenSymbol, bigint>> {
    this.seed(user);
    return { ...this.balances.get(user.toLowerCase())! };
  }

  async getRiskLimit(user: string): Promise<RiskLimitState> {
    this.seed(user);
    const cap = this.caps.get(user.toLowerCase())!;
    return {
      maxDailyNotionalUSD: cap.maxUSD,
      availableTodayUSD: Math.max(0, cap.maxUSD - cap.spentUSD),
    };
  }

  async executeSwap(req: SwapRequest): Promise<SwapResult> {
    this.seed(req.user);
    const key = req.user.toLowerCase();
    const bal = this.balances.get(key)!;
    const cap = this.caps.get(key)!;

    const amountIn = usdToTokenAmount(req.tokenIn, req.amountUSD, req.market);
    const out = minAmountOut(req.tokenOut, req.amountUSD, req.market);

    if (bal[req.tokenIn] < amountIn) {
      throw new Error(`Insufficient ${req.tokenIn} balance in mock vault.`);
    }
    if (cap.spentUSD + req.amountUSD > cap.maxUSD) {
      throw new Error("Mock daily risk limit exceeded.");
    }

    // Apply effects: debit in, credit out (1:1-by-USD, matching mock router).
    bal[req.tokenIn] -= amountIn;
    bal[req.tokenOut] += out;
    cap.spentUSD += req.amountUSD;

    // Deterministic pseudo-hash so the UI has something to show. Not random —
    // Math.random is unavailable in some harness contexts and unneeded here.
    const stamp = `${key}-${req.tokenIn}-${req.tokenOut}-${cap.spentUSD}`;
    const txHash =
      "0x" +
      Array.from(stamp)
        .reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381)
        .toString(16)
        .padStart(8, "0")
        .repeat(8)
        .slice(0, 64);

    return {
      txHash,
      amountIn: formatUnits(amountIn, getToken(req.tokenIn).decimals),
      minAmountOut: formatUnits(out, getToken(req.tokenOut).decimals),
      simulated: true,
    };
  }

  /** Test/demo helper: override a user's cap (mirrors setRiskLimit on-chain). */
  setCap(user: string, maxUSD: number): void {
    this.seed(user);
    this.caps.get(user.toLowerCase())!.maxUSD = maxUSD;
  }
}

// ── Live implementation ──────────────────────────────────────────────────────

/**
 * Talks to the deployed SableVault via viem. Reads (balances, risk limit) use a
 * public client; executeSwap is signed by the agent account. The agent can only
 * call executeSwap — it can never withdraw user funds (enforced on-chain).
 */
export class LiveVaultClient implements VaultClient {
  readonly mode = "live" as const;
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private account: Account;
  private vault: `0x${string}`;
  private router: `0x${string}`;

  constructor() {
    const key = config.agentPrivateKey.startsWith("0x")
      ? (config.agentPrivateKey as `0x${string}`)
      : (`0x${config.agentPrivateKey}` as `0x${string}`);
    this.account = privateKeyToAccount(key);
    const transport = http(config.agentRpcUrl);
    this.publicClient = createPublicClient({ transport });
    this.walletClient = createWalletClient({ account: this.account, transport });
    this.vault = getAddress(config.vaultAddress);
    this.router = getAddress(config.dexRouterAddress);
  }

  async getBalances(user: string): Promise<Record<TokenSymbol, bigint>> {
    const owner = getAddress(user);
    const entries = await Promise.all(
      TOKEN_SYMBOLS.map(async (symbol) => {
        const token = getToken(symbol);
        if (!token.address) return [symbol, 0n] as const;
        const bal = (await this.publicClient.readContract({
          address: this.vault,
          abi: SABLE_VAULT_ABI,
          functionName: "balanceOf",
          args: [owner, getAddress(token.address)],
        })) as bigint;
        return [symbol, bal] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<TokenSymbol, bigint>;
  }

  async getRiskLimit(user: string): Promise<RiskLimitState> {
    const owner = getAddress(user);
    const [maxDailyRaw, availableRaw] = await Promise.all([
      this.publicClient
        .readContract({
          address: this.vault,
          abi: SABLE_VAULT_ABI,
          functionName: "riskLimits",
          args: [owner],
        })
        .then((r) => (r as readonly bigint[])[0]),
      this.publicClient.readContract({
        address: this.vault,
        abi: SABLE_VAULT_ABI,
        functionName: "availableDailyNotional",
        args: [owner],
      }) as Promise<bigint>,
    ]);
    return {
      maxDailyNotionalUSD: Number(formatUnits(maxDailyRaw, USD_DECIMALS)),
      availableTodayUSD: Number(formatUnits(availableRaw, USD_DECIMALS)),
    };
  }

  async executeSwap(req: SwapRequest): Promise<SwapResult> {
    const user = getAddress(req.user);
    const tokenIn = getToken(req.tokenIn);
    const tokenOut = getToken(req.tokenOut);
    if (!tokenIn.address || !tokenOut.address) {
      throw new Error("Token addresses not configured for live swap.");
    }

    const amountIn = usdToTokenAmount(req.tokenIn, req.amountUSD, req.market);
    const minOut = minAmountOut(req.tokenOut, req.amountUSD, req.market);
    const amountInUSD = usdToVaultUnits(req.amountUSD);

    // Simulate first so we surface reverts (RiskLimitNotSet, DailyLimitExceeded,
    // InsufficientBalance, SlippageExceeded) as clean errors before spending gas.
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: this.vault,
      abi: SABLE_VAULT_ABI,
      functionName: "executeSwap",
      args: [
        user,
        getAddress(tokenIn.address),
        getAddress(tokenOut.address),
        amountIn,
        minOut,
        amountInUSD,
        this.router,
      ],
    });

    const txHash = await this.walletClient.writeContract(request);
    return {
      txHash,
      amountIn: formatUnits(amountIn, tokenIn.decimals),
      minAmountOut: formatUnits(minOut, tokenOut.decimals),
      simulated: false,
    };
  }
}
