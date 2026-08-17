# Getting a full, funded `.env` — step by step

This is the exact sequence to go from nothing to a working, funded environment.
There are **two `.env` files**: one at the repo root (`/home/l2e/xlayer/.env`, shared by
the contracts + agent backend) and one in `frontend/.env`. Copy the examples
first:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

## The three tiers (fill only what you need)

| Tier | What works | Required vars |
|------|-----------|---------------|
| **A — Mock (5 min)** | Full chat + AI reasoning + approve flow, in-memory vault, real live prices | `ANTHROPIC_API_KEY` only |
| **B — Live on testnet** | Real on-chain deposit / risk limit / swap with a tx hash | Tier A **+** wallet key, funded OKB, token addresses, DEX router, deployed vault |
| **C — Mainnet** | Same as B, on X Layer mainnet | Tier B values swapped for mainnet RPC + real mainnet addresses |

You can demo the entire product in **Tier A today**. Tiers B/C are what make the
on-chain swap real. Start at A, then do B when you have a funded wallet.

---

## Tier A — Mock mode (only 1 value)

### 1. Anthropic API key → `ANTHROPIC_API_KEY`
1. Go to https://console.anthropic.com → **Settings → API Keys → Create Key**.
2. Add billing credit (Plans & Billing) — the agent uses `claude-opus-5`.
3. Paste into root `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```

That's it. Run `cd agent && npm run dev` then `cd frontend && npm run dev`. The
header shows **MOCK MODE**, chat works, prices are live. Leave every other var
blank for now.

> The app stays in mock mode until `SABLE_VAULT_ADDRESS`, `AGENT_PRIVATE_KEY`,
> `AGENT_RPC_URL`, **and** `DEX_ROUTER_ADDRESS` are all set. Then it flips to
> live automatically — no code change.

### 1b. (Optional) Using a third-party Claude gateway → `ANTHROPIC_BASE_URL`

If your key is from a reseller/gateway (e.g. **AgentRouter**, `sk-bfwt…`-style
keys) rather than first-party Anthropic (`sk-ant-api03-…`), set the base URL too:

```
ANTHROPIC_API_KEY=sk-<your gateway key>
ANTHROPIC_BASE_URL=https://agentrouter.org
```

The agent detects the base URL and automatically switches to the auth style
these gateways require — it sends the key as a **Bearer token** (not `x-api-key`),
presents a `claude-cli/*` User-Agent (AgentRouter fingerprints the client and
only serves requests that look like the Claude Code CLI), and repairs the
`text/plain` response content-type the gateway returns. You don't configure any
of that; just set the two vars. Leave `ANTHROPIC_BASE_URL` blank to use
first-party `api.anthropic.com` with standard `x-api-key` auth.

> Override the User-Agent with `ANTHROPIC_USER_AGENT=` if a gateway expects a
> different client string.

---

## Tier B — Live on X Layer testnet

### 2. Create a fresh throwaway wallet → `PRIVATE_KEY`

**Never reuse a wallet that holds real funds.** Generate a brand-new key. viem is
already installed, so in **a separate terminal** (not pasted into this chat, so
the secret stays out of the transcript):

```bash
cd /home/l2e/xlayer/agent
node --input-type=module -e "import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'; const pk = generatePrivateKey(); console.log('PRIVATE_KEY=' + pk); console.log('ADDRESS    =' + privateKeyToAccount(pk).address);"
```

It prints a `PRIVATE_KEY=0x...` and its `ADDRESS=0x...`. Put the key in `.env`:

```
PRIVATE_KEY=0x<the-generated-key>
```

**One wallet or two?** Simplest for the hackathon: **use this one wallet for
everything** — deployer, owner, and agent. That means:

```
PRIVATE_KEY=0x<key>
AGENT_PRIVATE_KEY=0x<same key>
# INITIAL_OWNER and AGENT_ADDRESS can stay BLANK — they default to the deployer.
```

(In production you'd separate them: owner = a safe admin wallet, agent = the
hot key the backend signs with. For a demo, one key is fine and the on-chain
daily limit caps the blast radius.)

### 3. Fund it with testnet OKB (the gas token)
1. Copy the `ADDRESS` from step 2.
2. Go to the faucet: https://web3.okx.com/xlayer/faucet
3. Paste the address, request testnet OKB. You need gas to deploy + swap.
4. Verify it arrived on the explorer: https://www.oklink.com/x-layer-testnet
   (search your address).

### 4. Confirm the testnet chain ID → `XLAYER_TESTNET_CHAIN_ID`
The chain ID is **disputed** (OKX docs say `1952`, some aggregators say `195`).
Confirm the live value before deploying — connect your wallet to the testnet RPC
and check, or read it directly:

```bash
cd /home/l2e/xlayer/agent
node --input-type=module -e "import {createPublicClient, http} from 'viem'; const c = createPublicClient({transport: http('https://testrpc.xlayer.tech/terigon')}); console.log('chainId =', await c.getChainId());"
```

Set whatever it reports:
```
XLAYER_TESTNET_CHAIN_ID=<result>
XLAYER_CHAIN_ID=<same result>          # agent backend
```
And in `frontend/.env`: `VITE_XLAYER_CHAIN_ID=<same>` and
`VITE_XLAYER_RPC_URL=https://testrpc.xlayer.tech/terigon`.

### 5. Tokens + DEX router → the important decision

`executeSwap` needs three ERC-20 token addresses (OKB / USDC / WETH) **and** a
Uniswap-V2-style router, all on the target network. You have two paths:

**Path 1 — Deploy your own mock tokens + router to testnet (recommended for the demo).**
The repo already ships `MockERC20` and `MockRouter`. Deploying them gives you a
fully working, deterministic end-to-end swap without depending on third-party
testnet liquidity that may not exist. *I can write a `scripts/deployMocks.ts`
that deploys all four and prints the addresses ready to paste* — just say the
word.

**Path 2 — Use real testnet addresses.** Find canonical OKB/USDC/WETH ERC-20s
and a deployed V2 router on X Layer testnet via the OKLink explorer / X Layer
docs, and paste them. Only viable if such contracts + liquidity actually exist
on testnet.

Either way, fill (must match across both files):
```
# root .env
DEX_ROUTER_ADDRESS=0x...
TOKEN_OKB_ADDRESS=0x...
TOKEN_USDC_ADDRESS=0x...
TOKEN_WETH_ADDRESS=0x...
```
```
# frontend/.env
VITE_TOKEN_OKB_ADDRESS=0x...
VITE_TOKEN_USDC_ADDRESS=0x...
VITE_TOKEN_WETH_ADDRESS=0x...
```

### 6. Deploy the vault → `SABLE_VAULT_ADDRESS`
With steps 2–4 done:
```bash
npm run deploy:testnet
```
It prints the deployed vault address. Paste it into **both** files:
```
SABLE_VAULT_ADDRESS=0x...              # root .env
VITE_SABLE_VAULT_ADDRESS=0x...         # frontend/.env
```

### 7. OKLink API key → `OKLINK_API_KEY` (for verification)
Needed only to verify the contract source (an acceptance criterion, not required
to run). Get one at https://www.oklink.com → sign in → **API Management → Create
API Key**. Then:
```
OKLINK_API_KEY=...
```
```bash
npm run verify:testnet
```

### 8. WalletConnect project ID → `VITE_WALLETCONNECT_PROJECT_ID` (optional)
Only needed for the WalletConnect QR flow. Injected wallets (OKX Wallet,
MetaMask) work without it. If you want it: https://cloud.walletconnect.com →
create a project → copy the Project ID into `frontend/.env`.

### 9. CoinGecko key → `COINGECKO_API_KEY` (optional)
The public API works keyless (rate-limited). Add a free Demo key from
https://www.coingecko.com/en/developers/dashboard only if you hit rate limits.

---

## Tier C — Mainnet (when testnet works end to end)

Swap the testnet values for mainnet ones:
```
AGENT_RPC_URL=https://rpc.xlayer.tech
XLAYER_CHAIN_ID=196
```
```
# frontend/.env
VITE_XLAYER_CHAIN_ID=196
VITE_XLAYER_RPC_URL=https://rpc.xlayer.tech
```
Use **real** mainnet OKB/USDC/WETH addresses + a real DEX router (Path 2 above,
no mocks), fund the wallet with real OKB for gas, then `npm run deploy:mainnet`
and `npm run verify:mainnet`.

---

## Completed root `.env` — testnet, one-wallet example

```dotenv
# RPC
TESTNET_RPC_URL=https://testrpc.xlayer.tech/terigon
MAINNET_RPC_URL=https://rpc.xlayer.tech
XLAYER_TESTNET_CHAIN_ID=1952        # ← confirm with step 4

# Wallet (one throwaway key for deployer + agent)
PRIVATE_KEY=0x<generated>
AGENT_PRIVATE_KEY=0x<same>
INITIAL_OWNER=                       # blank = deployer
AGENT_ADDRESS=                       # blank = deployer

# AI
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5
COINGECKO_API_KEY=                   # optional

# Agent runtime
AGENT_RPC_URL=https://testrpc.xlayer.tech/terigon
XLAYER_CHAIN_ID=1952                 # ← same as above
AGENT_SLIPPAGE_BPS=100
PORT=8787

# On-chain addresses (from steps 5 & 6)
SABLE_VAULT_ADDRESS=0x...
DEX_ROUTER_ADDRESS=0x...
TOKEN_OKB_ADDRESS=0x...
TOKEN_USDC_ADDRESS=0x...
TOKEN_WETH_ADDRESS=0x...

# Verification
OKLINK_API_KEY=

# Mirror for reference (frontend reads frontend/.env)
VITE_SABLE_VAULT_ADDRESS=0x...
VITE_AGENT_API_URL=http://localhost:8787
VITE_WALLETCONNECT_PROJECT_ID=
```

## Security reminders
- `.env` and `frontend/.env` are **gitignored — never commit them.**
- The agent key is a **hot key**: fund it only with what you'll trade. The
  on-chain daily limit bounds how much the agent can ever move.
- Generate keys in a terminal **outside** any shared/logged session.
