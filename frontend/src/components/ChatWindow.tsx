/**
 * ChatWindow — the conversational surface. The user asks about their portfolio;
 * each question hits /api/advise and the agent's recommendation is rendered as a
 * TradeApprovalCard inline in the thread. This is where "chat → reasoning →
 * approve → on-chain swap" comes together.
 */
import { useRef, useState } from "react";
import type { AdviceResult, ExecuteResult } from "../lib/api";
import { api } from "../lib/api";
import { TradeApprovalCard } from "./TradeApprovalCard";

interface Turn {
  id: number;
  role: "user" | "agent";
  text?: string;
  advice?: AdviceResult;
}

interface Props {
  address: string;
  onActivity: () => void;
}

const SUGGESTIONS = [
  "How's my portfolio looking today?",
  "Should I take some risk off the table?",
  "WETH is dropping — should I rotate into USDC?",
];

export function ChatWindow({ address, onActivity }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  function nextId(): number {
    counter.current += 1;
    return counter.current;
  }

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    setTurns((t) => [...t, { id: nextId(), role: "user", text }]);
    setBusy(true);
    try {
      const advice = await api.advise(address, text);
      setTurns((t) => [...t, { id: nextId(), role: "agent", advice }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleExecuted(_r: ExecuteResult) {
    onActivity(); // refresh portfolio / history after a trade
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-sable-border bg-sable-panel">
      <div className="border-b border-sable-border px-4 py-3">
        <h2 className="text-sm font-semibold">Chat with Sable</h2>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="text-sm text-sable-muted">
            <p className="mb-3">Ask Sable about your portfolio. For example:</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-lg border border-sable-border bg-sable-bg px-3 py-2 text-left text-sm hover:border-sable-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-sable-accent px-4 py-2 text-sm text-white">
                {turn.text}
              </div>
            </div>
          ) : (
            <div key={turn.id} className="max-w-[92%]">
              {turn.advice && (
                <TradeApprovalCard
                  address={address}
                  advice={turn.advice}
                  onExecuted={handleExecuted}
                />
              )}
            </div>
          ),
        )}

        {busy && <div className="text-sm text-sable-muted">Sable is thinking…</div>}
        {error && <div className="text-sm text-sable-bad">{error}</div>}
      </div>

      <div className="border-t border-sable-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your portfolio…"
            disabled={busy}
            className="w-full rounded-lg border border-sable-border bg-sable-bg px-3 py-2 text-sm outline-none focus:border-sable-accent"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-lg bg-sable-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
