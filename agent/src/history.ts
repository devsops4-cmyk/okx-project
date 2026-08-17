/**
 * In-memory trade/advice history, keyed by user address. Backs GET
 * /api/history/:address so the UI can show what the agent has proposed and
 * executed. Process-local and non-durable — fine for a demo backend; a real
 * deployment would read SwapExecuted events from the chain instead.
 */
import type { AdviceResult } from "./types.js";

export interface HistoryEntry {
  id: string;
  createdAt: string;
  kind: "advice" | "execution";
  userMessage?: string;
  advice?: AdviceResult;
  execution?: {
    txHash: string;
    tokenIn: string;
    tokenOut: string;
    amountUSD: number;
    amountIn: string;
    minAmountOut: string;
    simulated: boolean;
  };
}

const store = new Map<string, HistoryEntry[]>();
let counter = 0;

/** Monotonic id without Math.random (unavailable in some harness contexts). */
function nextId(): string {
  counter += 1;
  return `h${counter.toString(36)}`;
}

export function addHistory(
  user: string,
  entry: Omit<HistoryEntry, "id" | "createdAt">,
  createdAt: string,
): HistoryEntry {
  const full: HistoryEntry = { id: nextId(), createdAt, ...entry };
  const key = user.toLowerCase();
  const list = store.get(key) ?? [];
  list.unshift(full); // newest first
  store.set(key, list.slice(0, 100)); // cap per-user history
  return full;
}

export function getHistory(user: string): HistoryEntry[] {
  return store.get(user.toLowerCase()) ?? [];
}
