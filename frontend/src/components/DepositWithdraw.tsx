/**
 * DepositWithdraw — the user funds their own vault balance (and can always exit).
 * Deposit is a two-step ERC-20 flow: approve the vault (only if the current
 * allowance is too low), then call deposit(). Every tx is awaited to a mined
 * receipt before the next step runs and before the portfolio refreshes — writes
 * resolve on *signature*, not on *inclusion*, so firing deposit right after
 * approve (or refreshing immediately) races the chain and looks like "nothing
 * happened." Withdraw works even when the contract is paused (users can always
 * retrieve funds) — enforced on-chain; here we just expose the call.
 */
import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ERC20_ABI, SABLE_VAULT_ABI, VAULT_ADDRESS } from "../lib/contract";
import { TOKEN_LIST, tokenBySymbol, type TokenSymbol } from "../lib/tokens";

interface Props {
  onDone: () => void;
}

/** Pull the most human-readable message viem/wallet errors expose. */
function errMessage(e: unknown): string {
  const anyErr = e as { shortMessage?: string; message?: string };
  return anyErr.shortMessage || anyErr.message || "Transaction failed.";
}

export function DepositWithdraw({ onDone }: Props) {
  const [symbol, setSymbol] = useState<TokenSymbol>("OKB");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const token = tokenBySymbol(symbol)!;

  function parsed(): bigint | null {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return parseUnits(amount, token.decimals);
  }

  async function deposit() {
    setError(null);
    const value = parsed();
    if (!value) return setError("Enter a positive amount.");
    if (!VAULT_ADDRESS) return setError("Vault address not configured.");
    if (!token.address) return setError(`No address configured for ${symbol}.`);
    if (!publicClient || !address) return setError("Wallet not connected.");
    setBusy(true);
    try {
      // Only approve if the existing allowance can't cover this deposit.
      const allowance = (await publicClient.readContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, VAULT_ADDRESS],
      })) as bigint;

      if (allowance < value) {
        setStatus("Approving… (confirm in wallet)");
        const approveHash = await writeContractAsync({
          address: token.address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [VAULT_ADDRESS, value],
        });
        setStatus("Waiting for approval to confirm…");
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setStatus("Depositing… (confirm in wallet)");
      const depositHash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: SABLE_VAULT_ABI,
        functionName: "deposit",
        args: [token.address, value],
      });
      setStatus("Waiting for deposit to confirm…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
      if (receipt.status !== "success") throw new Error("Deposit transaction reverted.");

      setStatus(`Deposited ${amount} ${symbol}.`);
      setAmount("");
      onDone();
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      setError(errMessage(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setError(null);
    const value = parsed();
    if (!value) return setError("Enter a positive amount.");
    if (!VAULT_ADDRESS) return setError("Vault address not configured.");
    if (!token.address) return setError(`No address configured for ${symbol}.`);
    if (!publicClient) return setError("Wallet not connected.");
    setBusy(true);
    try {
      setStatus("Withdrawing… (confirm in wallet)");
      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: SABLE_VAULT_ABI,
        functionName: "withdraw",
        args: [token.address, value],
      });
      setStatus("Waiting for withdrawal to confirm…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Withdraw transaction reverted.");

      setStatus(`Withdrew ${amount} ${symbol}.`);
      setAmount("");
      onDone();
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      setError(errMessage(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-sable-border bg-sable-panel p-4">
      <h2 className="mb-3 text-sm font-semibold text-sable-muted">Fund vault</h2>
      <div className="flex gap-2">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value as TokenSymbol)}
          disabled={busy}
          className="rounded-lg border border-sable-border bg-sable-bg px-2 py-2 text-sm outline-none disabled:opacity-50"
        >
          {TOKEN_LIST.map((t) => (
            <option key={t.symbol} value={t.symbol}>
              {t.symbol}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="w-full rounded-lg border border-sable-border bg-sable-bg px-3 py-2 text-sm outline-none focus:border-sable-accent disabled:opacity-50"
        />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={deposit}
          disabled={busy}
          className="flex-1 rounded-lg bg-sable-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Deposit
        </button>
        <button
          onClick={withdraw}
          disabled={busy}
          className="flex-1 rounded-lg border border-sable-border px-3 py-2 text-sm font-medium hover:border-sable-accent disabled:opacity-50"
        >
          Withdraw
        </button>
      </div>
      {status && <p className="mt-2 text-xs text-sable-good">{status}</p>}
      {error && <p className="mt-2 text-xs text-sable-bad">{error}</p>}
    </div>
  );
}
