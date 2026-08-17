/**
 * Off-chain mirror of the on-chain daily risk cap. Before the agent ever
 * proposes a swap to the user, we check the size against the user's remaining
 * daily allowance (read from the vault) and, if it doesn't fit, downgrade the
 * proposal to a hold with a plain explanation.
 *
 * This is a UX guardrail, NOT the security boundary: the real enforcement lives
 * in SableVault.executeSwap / _consumeDailyNotional, which reverts on the chain
 * regardless of what the agent sends. Downgrading here just avoids proposing a
 * trade we already know the contract would reject.
 */
import type { RiskCheck, RiskLimitState, TradeDecision } from "./types.js";

export interface RiskContext {
  limit: RiskLimitState;
  /** USD value of the user's tokenIn balance, to catch "can't afford" cases. */
  tokenInBalanceUSD: number;
}

/**
 * Apply the risk check to a raw proposal. Returns the (possibly downgraded)
 * decision plus a structured RiskCheck the API surfaces to the frontend.
 */
export function applyRiskCheck(
  proposal: TradeDecision,
  ctx: RiskContext,
): { decision: TradeDecision; riskCheck: RiskCheck } {
  const { limit } = ctx;

  // Holds are always fine — nothing to enforce.
  if (proposal.action === "hold") {
    return { decision: proposal, riskCheck: { ok: true, limit } };
  }

  // Agent trading disabled: user never set a cap (0 => contract reverts).
  if (limit.maxDailyNotionalUSD <= 0) {
    return {
      decision: downgrade(
        proposal,
        "Agent trading is off because you haven't set a daily risk limit yet. Set one to enable swaps.",
      ),
      riskCheck: {
        ok: false,
        limit,
        reason: "No risk limit set (maxDailyNotionalUSD = 0).",
      },
    };
  }

  // Exceeds remaining daily allowance.
  if (proposal.amountUSD > limit.availableTodayUSD + 1e-9) {
    return {
      decision: downgrade(
        proposal,
        `This $${proposal.amountUSD.toFixed(
          2,
        )} trade is larger than your remaining daily limit of $${limit.availableTodayUSD.toFixed(
          2,
        )}. Holding — raise your limit or wait until tomorrow to proceed.`,
      ),
      riskCheck: {
        ok: false,
        limit,
        reason: `Proposed $${proposal.amountUSD.toFixed(
          2,
        )} exceeds available $${limit.availableTodayUSD.toFixed(2)}.`,
      },
    };
  }

  // Can't afford: trade bigger than the user's tokenIn holding.
  if (proposal.amountUSD > ctx.tokenInBalanceUSD + 1e-9) {
    return {
      decision: downgrade(
        proposal,
        `You don't hold enough ${proposal.tokenIn} to cover a $${proposal.amountUSD.toFixed(
          2,
        )} swap. Holding.`,
      ),
      riskCheck: {
        ok: false,
        limit,
        reason: `Proposed $${proposal.amountUSD.toFixed(
          2,
        )} exceeds ${proposal.tokenIn} balance of ~$${ctx.tokenInBalanceUSD.toFixed(2)}.`,
      },
    };
  }

  return { decision: proposal, riskCheck: { ok: true, limit } };
}

/** Turn a swap proposal into a hold, preserving the model's reasoning + a note. */
function downgrade(proposal: TradeDecision, note: string): TradeDecision {
  return {
    action: "hold",
    tokenIn: "",
    tokenOut: "",
    amountUSD: 0,
    reasoning: `${proposal.reasoning} ${note}`,
    confidence: proposal.confidence,
  };
}
