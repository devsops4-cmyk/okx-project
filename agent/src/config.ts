/**
 * Central runtime config for the agent backend. Loads the repo-root .env (shared
 * with the contracts package) so a single file drives contract, agent, and
 * frontend wiring. Values are validated lazily — the server boots in mock mode
 * with nothing but an Anthropic key, and only requires chain vars once a real
 * vault address is present.
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load repo-root .env first, then an optional agent-local .env that overrides it.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../.env") });
loadEnv({ path: resolve(here, "../.env") });

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num("PORT", 8787),

  // ── Anthropic ────────────────────────────────────────────────────────────
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // Spec default: latest, most capable Claude. Overridable for cost tuning.
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  // Optional custom Anthropic base URL. Empty = first-party api.anthropic.com.
  // Set this to route through a compatible gateway (e.g. AgentRouter). The SDK
  // appends `/v1/messages`, so give the origin only (no trailing /v1).
  anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL ?? "").trim(),
  // User-Agent sent when a gateway is configured. AgentRouter (and similar
  // Claude Code resellers) fingerprint the client and only serve requests that
  // look like the CLI, so the default carries the claude-cli prefix.
  anthropicUserAgent:
    process.env.ANTHROPIC_USER_AGENT?.trim() || "claude-cli/2.1.219 (external, cli)",

  // ── Market data ──────────────────────────────────────────────────────────
  coingeckoApiKey: process.env.COINGECKO_API_KEY ?? "",

  // ── Chain / contract ─────────────────────────────────────────────────────
  vaultAddress: (process.env.SABLE_VAULT_ADDRESS ?? "").trim(),
  dexRouterAddress: (process.env.DEX_ROUTER_ADDRESS ?? "").trim(),
  agentPrivateKey: (process.env.AGENT_PRIVATE_KEY ?? "").trim(),
  agentRpcUrl: (process.env.AGENT_RPC_URL ?? "").trim(),
  chainId: num("XLAYER_CHAIN_ID", 196),

  // ── Trade sizing ─────────────────────────────────────────────────────────
  // Slippage tolerance applied when deriving minAmountOut, in basis points.
  slippageBps: num("AGENT_SLIPPAGE_BPS", 100), // 1%
} as const;

/**
 * The agent runs in "mock" mode until it has everything needed to talk to a
 * deployed vault: a vault address, a signer key, an RPC, and a router. This is
 * how spec build-step (3) — "AI agent backend with mocked contract calls first"
 * — coexists with step (5) — "connect agent to real deployed contract": flip
 * from mock to live purely by filling in .env, no code change.
 */
export function isLiveChain(): boolean {
  return Boolean(
    config.vaultAddress &&
      config.agentPrivateKey &&
      config.agentRpcUrl &&
      config.dexRouterAddress,
  );
}

export function assertAnthropicKey(): void {
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example).",
    );
  }
}
