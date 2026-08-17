/**
 * TradeApprovalCard — renders the agent's recommendation with its reasoning and
 * an explicit Approve action. Nothing executes until the user clicks Approve;
 * approval calls the backend which submits the on-chain swap through the agent
 * signer (still bounded by the user's on-chain daily limit).
 *
 * When the agent returns action="hold" — including a proposal downgraded because
 * it exceeded the on-chain cap — there is nothing to approve, so we show the
 * reasoning only.
 */
import { useState } from "react";
import type { AdviceResult, ExecuteResult } from "../lib/api";
import { api } from "../lib/api";
import { fmtUSD, shortHash } from "../lib/format";
import { ACTIVE_CHAIN_ID } from "../lib/chain";

interface Props {
  address: string;
  advice: AdviceResult;
  onExecuted: (r: ExecuteResult) => void;
}

const confidenceColor: Record<string, string> = {
  low: "text-sable-bad",
  medium: "text-yellow-400",
  high: "text-sable-good",
};

function explorerTx(hash: string): string {
  const base =
    ACTIVE_CHAIN_ID === 196
      ? "https://www.oklink.com/xlayer/tx/"
      : "https://www.oklink.com/x-layer-testnet/tx/";
  return base + hash;
}

export function TradeApprovalCard({ address, advice, onExecuted }: Props) {
  const { decision, proposal, riskCheck } = advice;
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const isSwap = decision.action === "swap";
  const wasDowngraded = proposal.action === "swap" && decision.action === "hold";

  async function approve() {
    setExecuting(true);
    setError(null);
    try {
      const r = await api.execute(
        address,
        decision.tokenIn,
        decision.tokenOut,
        decision.amountUSD,
      );
      setResult(r);
      onExecuted(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="rounded-xl border border-sable-border bg-sable-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-sable-muted">
          {isSwap ? "Proposed swap" : "Recommendation: hold"}
        </span>
        <span className={`text-xs font-medium ${confidenceColor[decision.confidence]}`}>
          {decision.confidence} confidence
        </span>
      </div>

      {isSwap && (
        <div className="mb-3 flex items-baseline gap-2 text-lg font-semibold">
          <span>{decision.tokenIn}</span>
          <span className="text-sable-muted">→</span>
          <span>{decision.tokenOut}</span>
          <span className="ml-auto text-base text-sable-accent">
            {fmtUSD(decision.amountUSD)}
          </span>
        </div>
      )}

      <p className="text-sm leading-relaxed text-gray-200">{decision.reasoning}</p>

      {wasDowngraded && (
        <p className="mt-3 rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-2 text-xs text-yellow-300">
          The agent proposed a {fmtUSD(proposal.amountUSD)} {proposal.tokenIn}→
          {proposal.tokenOut} swap, but it was held back:{" "}
          {riskCheck.reason || "exceeds your daily on-chain limit."}
        </p>
      )}

      {isSwap && !result && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={approve}
            disabled={executing}
            className="rounded-lg bg-sable-good px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {executing ? "Executing…" : "Approve & execute"}
          </button>
          <span className="text-xs text-sable-muted">
            {fmtUSD(riskCheck.limit.availableTodayUSD)} of daily limit remaining
          </span>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-sable-bad">{error}</p>}

      {result && (
        <div className="mt-4 rounded-lg border border-sable-border bg-sable-bg p-3 text-xs">
          <div className="mb-1 text-sable-good">
            Executed{result.mode === "mock" ? " (mock)" : ""}
          </div>
          <a
            href={explorerTx(result.txHash)}
            target="_blank"
            rel="noreferrer"
            className="text-sable-accent underline"
          >
            {shortHash(result.txHash)}
          </a>
        </div>
      )}
    </div>
  );
}
