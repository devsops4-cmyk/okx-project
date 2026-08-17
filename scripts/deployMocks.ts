import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
import { seedRouterPrices, type SeedSymbol } from "./routerPrices";

dotenv.config();

/**
 * Deploys the mock token + DEX stack used for a deterministic end-to-end demo on
 * X Layer testnet, so the vault can execute a real on-chain swap without relying
 * on third-party testnet liquidity that may not exist.
 *
 *   npm run deploy:mocks:testnet     # --network xlayerTestnet
 *
 * Deploys:
 *   - MockERC20  OKB  (18 decimals)
 *   - MockERC20  USDC ( 6 decimals)
 *   - MockERC20  WETH (18 decimals)
 *   - MockRouter (Uniswap V2-style test double; mints the output leg 1:1 by rate)
 *
 * Then mints a demo balance of each token to the OWNER wallet (INITIAL_OWNER, or
 * the deployer if unset) so you can immediately deposit into the vault from the
 * frontend. Finally prints the exact env vars to paste into root .env AND
 * frontend/.env.
 *
 * NOTE: MockRouter assumes both legs share decimals for its rate math (see the
 * contract). It never reverts on decimals, but for realistic-looking output pick
 * same-decimal legs (OKB<->WETH) when demoing; OKB/WETH -> USDC still executes
 * and emits a tx hash, which is what the on-chain-swap acceptance criterion needs.
 */

// Demo balances minted to the owner wallet (human-readable units).
const MINT = {
  OKB: 10_000n,
  USDC: 100_000n,
  WETH: 100n,
} as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const owner = process.env.INITIAL_OWNER || deployer.address;

  console.log("─".repeat(60));
  console.log(`Network:   ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(balance)} OKB`);
  console.log(`Mint to:   ${owner} (owner)`);
  console.log("─".repeat(60));

  if (balance === 0n) {
    throw new Error(
      "Deployer has 0 OKB. Fund PRIVATE_KEY's wallet from the faucet (https://web3.okx.com/xlayer/faucet) before deploying."
    );
  }

  const ERC20 = await ethers.getContractFactory("MockERC20");

  // [symbol, name, decimals, mint amount]
  const specs = [
    ["OKB", "Mock OKB", 18, MINT.OKB],
    ["USDC", "Mock USD Coin", 6, MINT.USDC],
    ["WETH", "Mock Wrapped Ether", 18, MINT.WETH],
  ] as const;

  const deployed: Record<string, string> = {};
  for (const [symbol, name, decimals, amount] of specs) {
    const token = await ERC20.deploy(name, symbol, decimals);
    await token.waitForDeployment();
    const address = await token.getAddress();
    deployed[symbol] = address;

    const units = amount * 10n ** BigInt(decimals);
    const tx = await token.mint(owner, units);
    await tx.wait();
    console.log(`✅ ${symbol.padEnd(4)} ${address}  (minted ${amount} to owner)`);
  }

  const Router = await ethers.getContractFactory("MockRouter");
  const router = await Router.deploy();
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`✅ ROUTER ${routerAddress}`);

  // Seed per-token USD prices from CoinGecko so agent-sized swaps clear the
  // slippage floor (the router does value-preserving, decimal-correct output).
  console.log("Seeding router prices from CoinGecko…");
  const seedTokens: Partial<Record<SeedSymbol, string>> = {
    OKB: deployed.OKB,
    USDC: deployed.USDC,
    WETH: deployed.WETH,
  };
  const seeded = await seedRouterPrices(router as unknown as any, seedTokens);
  for (const [sym, usd] of Object.entries(seeded)) {
    console.log(`   ${sym.padEnd(4)} $${usd}`);
  }

  const explorerBase =
    network.name === "xlayerMainnet"
      ? "https://www.oklink.com/xlayer/address"
      : "https://www.oklink.com/x-layer-testnet/address";

  console.log(`\n${"─".repeat(60)}`);
  console.log("Paste into root .env (agent + hardhat):");
  console.log(`   DEX_ROUTER_ADDRESS=${routerAddress}`);
  console.log(`   TOKEN_OKB_ADDRESS=${deployed.OKB}`);
  console.log(`   TOKEN_USDC_ADDRESS=${deployed.USDC}`);
  console.log(`   TOKEN_WETH_ADDRESS=${deployed.WETH}`);
  console.log("\nPaste into frontend/.env:");
  console.log(`   VITE_TOKEN_OKB_ADDRESS=${deployed.OKB}`);
  console.log(`   VITE_TOKEN_USDC_ADDRESS=${deployed.USDC}`);
  console.log(`   VITE_TOKEN_WETH_ADDRESS=${deployed.WETH}`);
  console.log(`\nExplorer: ${explorerBase}/${routerAddress}`);
  console.log(
    "\nNext: `npm run deploy:testnet` to deploy the vault, then paste SABLE_VAULT_ADDRESS into both .env files."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
