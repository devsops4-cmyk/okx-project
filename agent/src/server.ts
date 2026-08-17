/**
 * Sable agent backend — Express API.
 *
 * Endpoints:
 *   GET  /api/health            — liveness + which mode (mock/live) we're in
 *   GET  /api/market            — current market snapshot
 *   GET  /api/portfolio/:address — vault balances + risk limit for a user
 *   POST /api/advise            — run the LLM, apply the on-chain risk check,
 *                                 return a decision (may be a downgraded hold)
 *   POST /api/execute           — execute an approved swap through the vault
 *   GET  /api/history/:address  — past advice + executions for a user
 *
 * Contract calls go through a VaultClient that is mocked by default and becomes
 * live automatically once .env has a deployed vault + agent key (see config.ts).
 */
import express, { type Request, type Response } from "express";
import cors from "cors";
import { config, isLiveChain } from "./config.js";
import { getMarketSnapshot } from "./marketData.js";
import { getTradeDecision, LlmRateLimitError } from "./llm.js";
import { applyRiskCheck } from "./riskLimits.js";
import { addHistory, getHistory } from "./history.js";
import {
  MockVaultClient,
  LiveVaultClient,
  type VaultClient,
} from "./vaultClient.js";
import { getToken, TOKEN_SYMBOLS, type TokenSymbol } from "./tokens.js";
import { formatUnits } from "viem";
import type { AdviceResult, MarketSnapshot } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());

const vault: VaultClient = isLiveChain() ? new LiveVaultClient() : new MockVaultClient();
console.log(`[sable-agent] vault mode: ${vault.mode}`);

// ── helpers ──────────────────────────────────────────────────────────────────

function isAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

/** Convert raw per-token balances into approximate USD using a snapshot. */
function balancesToUSD(
  balances: Record<TokenSymbol, bigint>,
  market: MarketSnapshot,
): Record<TokenSymbol, number> {
  const out = {} as Record<TokenSymbol, number>;
  for (const symbol of TOKEN_SYMBOLS) {
    const human = Number(formatUnits(balances[symbol] ?? 0n, getToken(symbol).decimals));
    out[symbol] = human * (market.prices[symbol]?.usd ?? 0);
  }
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── routes ─────────────────────────────────────────────────────────────────

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    mode: vault.mode,
    model: config.anthropicModel,
    chainId: config.chainId,
    liveChain: isLiveChain(),
  });
});

app.get("/api/market", async (_req: Request, res: Response) => {
  const market = await getMarketSnapshot();
  res.json(market);
});

app.get("/api/portfolio/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  if (!isAddress(address)) {
    return res.status(400).json({ error: "Invalid address." });
  }
  try {
    const [market, balances, limit] = await Promise.all([
      getMarketSnapshot(),
      vault.getBalances(address),
      vault.getRiskLimit(address),
    ]);
    const balancesUSD = balancesToUSD(balances, market);
    res.json({
      address,
      balances: Object.fromEntries(
        TOKEN_SYMBOLS.map((s) => [
          s,
          {
            raw: (balances[s] ?? 0n).toString(),
            human: formatUnits(balances[s] ?? 0n, getToken(s).decimals),
            usd: balancesUSD[s],
          },
        ]),
      ),
      riskLimit: limit,
      market,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/advise", async (req: Request, res: Response) => {
  const { address, message } = req.body ?? {};
  if (!isAddress(address)) {
    return res.status(400).json({ error: "Invalid or missing address." });
  }
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing message." });
  }

  try {
    const [market, balances, limit] = await Promise.all([
      getMarketSnapshot(),
      vault.getBalances(address),
      vault.getRiskLimit(address),
    ]);
    const balancesUSD = balancesToUSD(balances, market);

    const proposal = await getTradeDecision({
      userMessage: message.trim(),
      balancesUSD,
      market,
      availableTodayUSD: limit.availableTodayUSD,
    });

    const tokenInBalanceUSD =
      proposal.action === "swap" ? balancesUSD[proposal.tokenIn as TokenSymbol] ?? 0 : 0;

    const { decision, riskCheck } = applyRiskCheck(proposal, {
      limit,
      tokenInBalanceUSD,
    });

    const result: AdviceResult = { decision, proposal, riskCheck, market };
    addHistory(address, { kind: "advice", userMessage: message.trim(), advice: result }, nowIso());
    res.json(result);
  } catch (err) {
    // A provider rate-limit is a transient, user-actionable condition — return
    // 429 (with Retry-After when known) and a friendly message, not a 500.
    if (err instanceof LlmRateLimitError) {
      if (err.retryAfterSec) res.setHeader("Retry-After", String(err.retryAfterSec));
      return res.status(429).json({ error: err.message });
    }
    console.error("[advise] error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/execute", async (req: Request, res: Response) => {
  const { address, tokenIn, tokenOut, amountUSD } = req.body ?? {};
  if (!isAddress(address)) {
    return res.status(400).json({ error: "Invalid or missing address." });
  }
  if (
    !TOKEN_SYMBOLS.includes(tokenIn) ||
    !TOKEN_SYMBOLS.includes(tokenOut) ||
    tokenIn === tokenOut
  ) {
    return res.status(400).json({ error: "Invalid token pair." });
  }
  if (typeof amountUSD !== "number" || !(amountUSD > 0)) {
    return res.status(400).json({ error: "amountUSD must be a positive number." });
  }

  try {
    // Re-read fresh market + limit at execution time so we never act on stale
    // pricing, and so the risk check reflects any allowance already consumed.
    const [market, limit, balances] = await Promise.all([
      getMarketSnapshot(),
      vault.getRiskLimit(address),
      vault.getBalances(address),
    ]);
    if (market.degraded) {
      return res
        .status(409)
        .json({ error: "Market data is temporarily unavailable; execution paused." });
    }
    const balancesUSD = balancesToUSD(balances, market);
    const guard = applyRiskCheck(
      { action: "swap", tokenIn, tokenOut, amountUSD, reasoning: "", confidence: "low" },
      { limit, tokenInBalanceUSD: balancesUSD[tokenIn as TokenSymbol] ?? 0 },
    );
    if (!guard.riskCheck.ok) {
      return res.status(409).json({ error: guard.riskCheck.reason, riskCheck: guard.riskCheck });
    }

    const result = await vault.executeSwap({
      user: address,
      tokenIn,
      tokenOut,
      amountUSD,
      market,
    });

    addHistory(
      address,
      {
        kind: "execution",
        execution: {
          txHash: result.txHash,
          tokenIn,
          tokenOut,
          amountUSD,
          amountIn: result.amountIn,
          minAmountOut: result.minAmountOut,
          simulated: result.simulated,
        },
      },
      nowIso(),
    );

    res.json({ ...result, mode: vault.mode });
  } catch (err) {
    console.error("[execute] error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/history/:address", (req: Request, res: Response) => {
  const { address } = req.params;
  if (!isAddress(address)) {
    return res.status(400).json({ error: "Invalid address." });
  }
  res.json({ address, history: getHistory(address) });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`[sable-agent] listening on http://0.0.0.0:${config.port}`);
  if (vault.mode === "mock") {
    console.log(
      "[sable-agent] running in MOCK mode — set SABLE_VAULT_ADDRESS, AGENT_PRIVATE_KEY, AGENT_RPC_URL, DEX_ROUTER_ADDRESS in .env to go live.",
    );
  }
});
