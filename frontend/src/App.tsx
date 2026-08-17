/**
 * App shell. Left column: portfolio, funding, and the on-chain risk limit.
 * Right column: the chat with the agent. A wallet must be connected before the
 * user can interact; everything keys off the connected address.
 */
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { usePortfolio } from "./hooks/usePortfolio";
import { PortfolioPanel } from "./components/PortfolioPanel";
import { RiskSettings } from "./components/RiskSettings";
import { DepositWithdraw } from "./components/DepositWithdraw";
import { Faucet } from "./components/Faucet";
import { ChatWindow } from "./components/ChatWindow";
import { VAULT_ADDRESS } from "./lib/contract";
import { ACTIVE_CHAIN_ID } from "./lib/chain";
import { api } from "./lib/api";

export default function App() {
  const { address, isConnected } = useAccount();
  const { data, loading, refresh } = usePortfolio(address);
  const [mode, setMode] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setMode(h.mode))
      .catch(() => setMode(null));
  }, []);

  return (
    <div className="min-h-screen bg-sable-bg text-gray-100">
      <header className="border-b border-sable-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-xl font-semibold tracking-tight">Sable</span>
            <span className="text-xs text-sable-muted">AI Trading Co-Pilot · X Layer</span>
            {mode && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                  mode === "live"
                    ? "bg-sable-good/20 text-sable-good"
                    : "bg-yellow-500/20 text-yellow-300"
                }`}
              >
                {mode} mode
              </span>
            )}
          </div>
          <ConnectButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {!isConnected || !address ? (
          <div className="rounded-xl border border-sable-border bg-sable-panel p-10 text-center">
            <h1 className="mb-2 text-lg font-semibold">Connect your wallet to begin</h1>
            <p className="text-sm text-sable-muted">
              Sable proposes trades with visible reasoning. You approve every swap, and an
              on-chain daily limit caps what the agent can ever trade.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <div className="space-y-6">
              <PortfolioPanel data={data} loading={loading} />
              {VAULT_ADDRESS ? (
                <>
                  <DepositWithdraw onDone={refresh} />
                  {ACTIVE_CHAIN_ID !== 196 && <Faucet onDone={refresh} />}
                  <RiskSettings
                    currentLimitUSD={data?.riskLimit.maxDailyNotionalUSD}
                    onUpdated={refresh}
                  />
                </>
              ) : (
                <div className="rounded-xl border border-yellow-700/50 bg-yellow-900/20 p-4 text-xs text-yellow-300">
                  Vault address not configured (VITE_SABLE_VAULT_ADDRESS). Deposit, withdraw,
                  and risk-limit controls appear once the contract is deployed. The chat below
                  works against the backend {mode ? `(${mode} mode)` : ""}.
                </div>
              )}
            </div>

            <div className="h-[70vh] min-h-[520px]">
              <ChatWindow address={address} onActivity={refresh} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
