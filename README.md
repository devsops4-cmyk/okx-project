# Sable — AI Trading Co-Pilot on X Layer

Sable is a non-custodial trading co-pilot. You chat with an AI agent about your
portfolio; it reasons about current market conditions using a large language
model (Claude), proposes a single swap or rebalance with its reasoning shown in
plain English, and — once you approve — executes the trade through a vault smart
contract on [X Layer](https://web3.okx.com/xlayer). Every trade the agent can
make is bounded by a **daily USD limit you set on-chain**, enforced by the
contract itself, not just the UI.

> Built for the OKX X Layer "Build X Series — AI Season" hackathon.

---

## What it does (the full flow)

1. **Connect** an EVM wallet (OKX Wallet / MetaMask / WalletConnect) to X Layer.
2. **Deposit** OKB, USDC, or WETH into your own tracked balance in the vault.
3. **Set a daily risk limit** (in USD) — the max the agent may ever trade on your
   behalf per day. This is a transaction you sign; it's stored and enforced
   on-chain. Setting it to `0` disables agent trading entirely.
4. **Ask the agent** something like *"WETH is dropping — should I rotate into
   USDC?"*. The backend pulls live prices, asks Claude for a decision, and
   returns a recommendation with reasoning tied to the real market data.
5. **Approve** the proposed swap. The agent submits `executeSwap` to the vault.
   The contract re-checks your balance, your slippage floor, and your daily
   limit before it moves anything, then emits a `SwapExecuted` event with the
   transaction hash.

You are always in control: you can withdraw at any time (even if the contract is
paused), and the agent can *only* swap within your vault balance — it can never
withdraw funds out.

---

## Architecture

```
┌─────────────┐    chat      ┌──────────────────┐   prices    ┌────────────┐
│  Frontend   │ ───────────▶ │   Agent backend  │ ──────────▶ │ CoinGecko  │
│ React+wagmi │              │  Express + Claude │             └────────────┘
│  RainbowKit │ ◀─────────── │                  │
└─────┬───────┘  decision +  └────────┬─────────┘
      │          reasoning            │ executeSwap (agent-signed)
      │ deposit / withdraw            │
      │ setRiskLimit (user-signed)    ▼
      │                       ┌──────────────────┐    swap     ┌────────────┐
      └─────────────────────▶ │   SableVault     │ ──────────▶ │ DEX router │
                              │  (X Layer, OKB)  │             │ (Uni V2)   │
                              └──────────────────┘             └────────────┘
```

Three packages in this repo:

| Path        | What it is                                    | Stack |
|-------------|-----------------------------------------------|-------|
| `contracts/`, `scripts/`, `test/` | The `SableVault` smart contract, tests, and deploy/verify scripts | Solidity ^0.8.20, Hardhat, OpenZeppelin v5, TypeChain |
| `agent/`    | The AI agent backend (REST API)               | Node, Express, `@anthropic-ai/sdk`, viem, CoinGecko |
| `frontend/` | The chat UI                                   | Vite, React, wagmi, viem, RainbowKit, Tailwind |

### The trust model (why the on-chain limit matters)

Valuing arbitrary tokens in USD *on-chain* would require a price oracle, which is
out of scope for this build. Instead, the agent passes the swap's USD notional
(`amountInUSD`) to the contract, and the contract **accumulates it against your
daily cap and reverts if you'd exceed it**. This narrows the trust assumption to
exactly one thing: the agent reports the trade's notional honestly. Everything
else — that the agent can't overspend your daily budget, can't touch tokens you
didn't deposit, and can't withdraw to itself — is guaranteed by the contract.
The clean upgrade path is to replace the agent-supplied notional with an on-chain
oracle read; the enforcement logic stays the same.

### `SableVault` — the core contract

- **Non-custodial**: `deposit` / `withdraw` move funds between your wallet and
  your own tracked balance. `withdraw` works even while paused.
- **Agent-gated swaps**: only the configured `agent` address can call
  `executeSwap`, and only to swap *within* a user's vault balance.
- **On-chain risk cap**: `setRiskLimit(maxDailyNotionalUSD)` (USD with 8
  decimals). `executeSwap` calls `_consumeDailyNotional`, which rolls a 24h
  window and reverts with `DailyLimitExceeded` / `RiskLimitNotSet`.
- **Safety**: `ReentrancyGuard`, checks-effects-interactions, `SafeERC20`,
  fee-on-transfer-safe deposits (measures the received delta), a slippage floor
  (`minAmountOut`) re-checked after the swap, and `Ownable` + `Pausable` admin.

See [`contracts/SableVault.sol`](contracts/SableVault.sol). Test suite:
[`test/SableVault.test.ts`](test/SableVault.test.ts) (22 tests covering
accounting, authorization, slippage, the daily-limit window, pause behavior, and
agent rotation).

---

## How AI is used

The agent's decision-making lives in [`agent/src/`](agent/src):

- **`marketData.ts`** fetches live USD spot + 24h change for OKB / USDC / WETH
  from CoinGecko. If the feed fails, it serves the last good snapshot flagged
  `degraded` — the agent is told to hold rather than trade on stale data.
- **`prompts/tradeDecision.ts`** holds the system prompt and the JSON schema for
  the decision. The model is instructed to reason **only** from the numbers it's
  given (never invent prices or news), size trades conservatively, hold when
  uncertain, and only ever touch the three supported tokens.
- **`llm.ts`** calls Claude (`claude-opus-5` by default) through the Messages
  API and **forces a single tool call** whose input schema *is* the decision
  shape. Forcing the tool call is what makes the output strict, parseable JSON:
  `{ action, tokenIn, tokenOut, amountUSD, reasoning, confidence }`. The result
  is defensively normalized so a malformed decision can never reach the swap
  path.
- **`riskLimits.ts`** takes the model's raw proposal and checks its size against
  your remaining on-chain daily allowance *before* showing it to you. If it
  doesn't fit (or you never set a limit), the proposal is **downgraded to a
  hold** with a plain explanation. This is a UX guardrail; the contract is the
  real enforcement.

The model proposes; the human approves; the contract enforces. The LLM is never
in a position to move funds on its own.

---

## Setup

### Prerequisites

- Node 18+ and npm
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- A funded X Layer wallet (testnet OKB from the
  [faucet](https://web3.okx.com/xlayer/faucet)) for deployment
- The DEX router address and the OKB/USDC/WETH token addresses for your target
  network

### 1. Configure environment

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

**New here? Follow [`ENV_SETUP.md`](ENV_SETUP.md)** — a step-by-step guide to
generating a throwaway wallet, funding it from the faucet, and filling in every
value. It's tiered: you can run the whole app in mock mode with just an Anthropic
key, then go live on testnet when you have a funded wallet.

Fill in `.env` — every variable is documented in
[`.env.example`](.env.example). At minimum:

- `ANTHROPIC_API_KEY` — to run the agent
- `PRIVATE_KEY` / `AGENT_PRIVATE_KEY` — a **fresh throwaway key** funded only
  with testnet OKB (never reuse a key holding real funds)
- `DEX_ROUTER_ADDRESS`, `TOKEN_OKB_ADDRESS`, `TOKEN_USDC_ADDRESS`,
  `TOKEN_WETH_ADDRESS` — for on-chain swaps

`.env` is gitignored. Never commit it.

### 2. Smart contract

```bash
npm install
npm run compile
npm test                 # 22 passing
npm run deploy:testnet   # deploys to X Layer testnet, prints the address
npm run verify:testnet   # verifies on Sourcify (keyless)
```

Copy the deployed address into `SABLE_VAULT_ADDRESS` (for the agent) and
`frontend/.env` → `VITE_SABLE_VAULT_ADDRESS`.

#### (Optional) Deploy a mock token + DEX stack for a self-contained demo

X Layer testnet may not have liquid OKB/USDC/WETH markets or a public router to
trade against. To get a fully working end-to-end demo (real on-chain swaps,
`SwapExecuted` events, tx hashes) without depending on third-party liquidity,
deploy the bundled mocks first:

```bash
npm run deploy:mocks:testnet   # 3 MockERC20s (OKB/USDC/WETH) + a MockRouter
```

It mints demo balances to `INITIAL_OWNER` and prints the exact env block to paste
into both `.env` and `frontend/.env` (`DEX_ROUTER_ADDRESS`, `TOKEN_*_ADDRESS`,
`VITE_TOKEN_*_ADDRESS`). Then run `npm run deploy:testnet` for the vault. The
`MockRouter` is **price- and decimal-aware**: it stores a USD price per token
(seeded from CoinGecko at deploy) and mints a value-preserving, decimal-corrected
output, so a swap the agent sized against live prices clears the on-chain slippage
floor instead of reverting on a price/decimal mismatch. For a real deployment,
point `DEX_ROUTER_ADDRESS` at an actual Uniswap-V2-style router and use the real
token addresses instead.

If the token contracts already exist and you only need to (re)deploy the router —
e.g. to refresh its seeded prices — use the router-only script, which leaves the
tokens (and everyone's vault balances) untouched:

```bash
npm run deploy:router:testnet   # deploys MockRouter, re-seeds prices, prints DEX_ROUTER_ADDRESS
```

Update `DEX_ROUTER_ADDRESS` in the root `.env` and restart the agent — the router
address is passed per-call, so no vault redeploy is needed.

### 3. Agent backend

```bash
cd agent
npm install
npm run dev              # http://localhost:8787
```

Runs in **mock mode** (in-memory vault, real Claude + real prices) until
`SABLE_VAULT_ADDRESS`, `AGENT_PRIVATE_KEY`, `AGENT_RPC_URL`, and
`DEX_ROUTER_ADDRESS` are all set — then it automatically talks to the deployed
contract. No code change needed to go live.

### 4. Frontend

```bash
cd frontend
cp .env.example .env     # fill in VITE_* vars
npm install
npm run dev              # http://localhost:5173, proxies /api to the backend
```

### Run both servers at once

The frontend and agent backend are **separate processes** — the frontend calls
the backend for every chat and swap. Running only the frontend leaves nothing at
`:8787`, so the chat fails with **"Failed to fetch."** From the repo root:

```bash
npm run dev              # starts the agent backend (:8787) AND the frontend (:5173)
```

Ctrl-C stops both. (Under the hood this runs [`scripts/dev.sh`](scripts/dev.sh).)
Quick check that the backend is up: open http://localhost:8787/api/health — it
should return JSON with `"mode":"live"`.

---

## Building order (how this was built)

Following the spec's incremental order: (1) contract + tests → (2) testnet
deploy → (3) agent backend with mocked contract calls → (4) frontend wired to
the running backend → (5) connect the agent to the real deployed contract →
(6) end-to-end test → (7) mainnet deploy. The mock/live split in the agent is
what lets steps 3–4 run fully before any contract is deployed.

## Network parameters

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | `196` | `1952` (per OKX docs; some aggregators list `195` — confirm before deploy) |
| RPC | `https://rpc.xlayer.tech` | `https://testrpc.xlayer.tech/terigon` |
| Explorer | https://www.oklink.com/xlayer | https://www.oklink.com/x-layer-testnet |
| Gas token | OKB | OKB (from the [faucet](https://web3.okx.com/xlayer/faucet)) |

## API reference (agent backend)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/health` | Liveness + mock/live mode + model |
| `GET`  | `/api/market` | Current price snapshot |
| `GET`  | `/api/portfolio/:address` | Vault balances + risk limit |
| `POST` | `/api/advise` | `{address, message}` → decision + reasoning (risk-checked) |
| `POST` | `/api/execute` | `{address, tokenIn, tokenOut, amountUSD}` → tx hash |
| `GET`  | `/api/history/:address` | Past advice + executions |

## Scope

Deliberately tight, per the build spec: three tokens (OKB/USDC/WETH), one swap
per recommendation, one DEX router. No custom ML, no multi-strategy engine, no
order book, no cross-chain. The goal is a small, complete, working product.

## Security notes

- Use a fresh, throwaway private key for the agent — funded only with what you're
  willing to trade. The daily on-chain limit bounds the blast radius.
- `.env` files are gitignored and must never be committed.
- The agent can only call `executeSwap`; it cannot withdraw. Withdrawals are
  user-signed and always available.
