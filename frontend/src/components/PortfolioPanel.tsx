/**
 * Shows the user's in-vault balances and remaining daily notional. Numbers come
 * from the agent backend so they match what the agent reasons over.
 */
import type { PortfolioResponse } from "../lib/api";
import { fmtPct, fmtUSD } from "../lib/format";

interface Props {
  data: PortfolioResponse | null;
  loading: boolean;
}

export function PortfolioPanel({ data, loading }: Props) {
  return (
    <div className="rounded-xl border border-sable-border bg-sable-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sable-muted">Vault portfolio</h2>
        {loading && <span className="text-xs text-sable-muted">refreshing…</span>}
      </div>

      {!data ? (
        <p className="text-sm text-sable-muted">Connect a wallet to load balances.</p>
      ) : (
        <>
          <div className="space-y-2">
            {Object.entries(data.balances).map(([symbol, b]) => (
              <div key={symbol} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{symbol}</span>
                  <span className="text-sable-muted">
                    {data.market.prices[symbol]
                      ? fmtPct(data.market.prices[symbol].change24hPct)
                      : ""}
                  </span>
                </div>
                <div className="text-right">
                  <div>{b.human}</div>
                  <div className="text-xs text-sable-muted">{fmtUSD(b.usd)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-sable-border pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-sable-muted">Daily limit</span>
              <span>{fmtUSD(data.riskLimit.maxDailyNotionalUSD)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sable-muted">Remaining today</span>
              <span className="text-sable-good">
                {fmtUSD(data.riskLimit.availableTodayUSD)}
              </span>
            </div>
          </div>

          {data.market.degraded && (
            <p className="mt-3 text-xs text-sable-bad">
              Market data is degraded — prices may be stale.
            </p>
          )}
        </>
      )}
    </div>
  );
}
