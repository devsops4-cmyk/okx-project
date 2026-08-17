/**
 * RiskSettings — lets the user set their on-chain daily notional cap by calling
 * SableVault.setRiskLimit directly from their own wallet. This is the security
 * hinge of the product: the limit the agent must respect is written on-chain by
 * the user's signature, not by the agent or backend. Setting it to 0 disables
 * agent trading entirely.
 */
import { useState } from "react";
import { parseUnits } from "viem";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { SABLE_VAULT_ABI, USD_DECIMALS, VAULT_ADDRESS } from "../lib/contract";

interface Props {
  currentLimitUSD?: number;
  onUpdated: () => void;
}

export function RiskSettings({ currentLimitUSD, onUpdated }: Props) {
  const [value, setValue] = useState("");
  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);

  const { isLoading: confirming } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });

  async function submit() {
    setError(null);
    if (!VAULT_ADDRESS) {
      setError("Vault address not configured (VITE_SABLE_VAULT_ADDRESS).");
      return;
    }
    const usd = Number(value);
    if (!Number.isFinite(usd) || usd < 0) {
      setError("Enter a non-negative dollar amount.");
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: SABLE_VAULT_ABI,
        functionName: "setRiskLimit",
        // Contract stores USD with 8 decimals.
        args: [parseUnits(usd.toString(), USD_DECIMALS)],
      });
      setTxHash(hash);
      // Give the node a moment, then refresh the portfolio view.
      setTimeout(onUpdated, 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="rounded-xl border border-sable-border bg-sable-panel p-4">
      <h2 className="mb-1 text-sm font-semibold text-sable-muted">Daily risk limit</h2>
      <p className="mb-3 text-xs text-sable-muted">
        The maximum USD the agent may trade on your behalf per day. Enforced on-chain.
        Set 0 to disable agent trading.
      </p>

      {currentLimitUSD !== undefined && (
        <p className="mb-2 text-sm">
          Current:{" "}
          <span className="font-medium">
            {currentLimitUSD > 0 ? `$${currentLimitUSD}/day` : "not set (trading off)"}
          </span>
        </p>
      )}

      <div className="flex gap-2">
        <input
          type="number"
          min="0"
          inputMode="decimal"
          placeholder="e.g. 500"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-sable-border bg-sable-bg px-3 py-2 text-sm outline-none focus:border-sable-accent"
        />
        <button
          onClick={submit}
          disabled={isPending || confirming}
          className="rounded-lg bg-sable-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? "Signing…" : confirming ? "Confirming…" : "Set limit"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-sable-bad">{error}</p>}
      {txHash && !confirming && (
        <p className="mt-2 text-xs text-sable-good">Limit updated on-chain.</p>
      )}
    </div>
  );
}
