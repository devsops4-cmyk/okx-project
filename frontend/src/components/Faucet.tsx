/**
 * Faucet — testnet only. Mints a fixed, capped amount of each mock token
 * (1000 USDC, 1 WETH, 1 OKB) straight to the connected wallet so a fresh user
 * can try the full flow without hunting for a public faucet. The mock ERC-20s
 * expose a permissionless `mint(to, amount)`; real tokens do not, so this whole
 * panel is hidden on mainnet (see App.tsx). Tokens land in the wallet — the user
 * then deposits them into the vault with the panel below.
 *
 * Each token is a separate mint tx (there's no batch mint on the mock), awaited
 * to a mined receipt before the next — same reasoning as the deposit flow: writes
 * resolve on signature, not inclusion.
 */
import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { TOKEN_LIST, type TokenSymbol } from "../lib/tokens";

/** Per-claim mint amounts (human units). Capped per the testnet faucet policy. */
const FAUCET_AMOUNTS: Record<TokenSymbol, string> = {
  USDC: "1000",
  WETH: "1",
  OKB: "1",
};

/** Mock ERC-20 mint. Present only on the testnet mock tokens. */
const MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

interface Props {
  onDone: () => void;
}

/** Pull the most human-readable message viem/wallet errors expose. */
function errMessage(e: unknown): string {
  const anyErr = e as { shortMessage?: string; message?: string };
  return anyErr.shortMessage || anyErr.message || "Transaction failed.";
}

export function Faucet({ onDone }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Only tokens with a configured address can be minted.
  const mintable = TOKEN_LIST.filter((t) => t.address);
  const summary = mintable
    .map((t) => `${FAUCET_AMOUNTS[t.symbol]} ${t.symbol}`)
    .join(" · ");

  async function claim() {
    setError(null);
    if (!publicClient || !address) return setError("Wallet not connected.");
    if (mintable.length === 0) return setError("No token addresses configured.");
    setBusy(true);
    try {
      for (let i = 0; i < mintable.length; i++) {
        const t = mintable[i];
        const amount = parseUnits(FAUCET_AMOUNTS[t.symbol], t.decimals);
        setStatus(
          `Minting ${FAUCET_AMOUNTS[t.symbol]} ${t.symbol}… (${i + 1}/${mintable.length}, confirm in wallet)`
        );
        const hash = await writeContractAsync({
          address: t.address,
          abi: MINT_ABI,
          functionName: "mint",
          args: [address, amount],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`${t.symbol} mint reverted.`);
      }
      setStatus("Test tokens minted to your wallet. Deposit them below to fund the vault.");
      onDone();
      setTimeout(() => setStatus(null), 6000);
    } catch (e) {
      setError(errMessage(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-sable-border bg-sable-panel p-4">
      <h2 className="mb-1 text-sm font-semibold text-sable-muted">Testnet faucet</h2>
      <p className="mb-3 text-xs text-sable-muted">
        Mint mock tokens to your wallet to try Sable: {summary}.
      </p>
      <button
        onClick={claim}
        disabled={busy}
        className="w-full rounded-lg border border-sable-border px-3 py-2 text-sm font-medium hover:border-sable-accent disabled:opacity-50"
      >
        {busy ? "Minting…" : "Get test tokens"}
      </button>
      {status && <p className="mt-2 text-xs text-sable-good">{status}</p>}
      {error && <p className="mt-2 text-xs text-sable-bad">{error}</p>}
    </div>
  );
}
