/**
 * Portfolio hook: fetches the user's vault balances + risk limit from the agent
 * backend and refreshes on demand. The backend is the single source of truth for
 * what the agent sees, so the UI reads the same numbers the agent reasons over.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type PortfolioResponse } from "../lib/api";

export function usePortfolio(address?: string) {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.portfolio(address));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
