import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
import { seedRouterPrices, type SeedSymbol } from "./routerPrices";

dotenv.config();

/**
 * Redeploys ONLY the MockRouter and seeds its per-token USD prices from live
 * CoinGecko data, then prints the new DEX_ROUTER_ADDRESS to paste into .env.
 *
 *   npm run deploy:router:testnet     # --network xlayerTestnet
 *
 * Use this when the token contracts (and everyone's vault balances) already
 * exist and you only need a corrected router — unlike `deploy:mocks`, this does
 * NOT redeploy the tokens, so existing deposits stay intact. The router address
 * is passed per-call by the agent (SableVault takes it as a parameter), so no
 * vault redeploy is needed either: update DEX_ROUTER_ADDRESS and restart the agent.
 *
 * Requires TOKEN_OKB_ADDRESS / TOKEN_USDC_ADDRESS / TOKEN_WETH_ADDRESS in .env
 * (the already-deployed mock tokens).
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  const tokens: Partial<Record<SeedSymbol, string>> = {
    OKB: (process.env.TOKEN_OKB_ADDRESS ?? "").trim(),
    USDC: (process.env.TOKEN_USDC_ADDRESS ?? "").trim(),
    WETH: (process.env.TOKEN_WETH_ADDRESS ?? "").trim(),
  };

  console.log("─".repeat(60));
  console.log(`Network:   ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(balance)} OKB`);
  console.log("─".repeat(60));

  if (balance === 0n) {
    throw new Error(
      "Deployer has 0 OKB. Fund PRIVATE_KEY's wallet from the faucet (https://web3.okx.com/xlayer/faucet) before deploying.",
    );
  }
  for (const [sym, addr] of Object.entries(tokens)) {
    if (!addr) {
      throw new Error(
        `TOKEN_${sym}_ADDRESS is not set in .env. Deploy the mock tokens first (npm run deploy:mocks:testnet), or fill in the existing addresses.`,
      );
    }
  }

  const Router = await ethers.getContractFactory("MockRouter");
  const router = await Router.deploy();
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`✅ ROUTER ${routerAddress}`);

  console.log("Seeding prices from CoinGecko…");
  const prices = await seedRouterPrices(router as unknown as any, tokens);
  for (const [sym, usd] of Object.entries(prices)) {
    console.log(`   ${sym.padEnd(4)} $${usd}`);
  }

  const explorerBase =
    network.name === "xlayerMainnet"
      ? "https://www.oklink.com/xlayer/address"
      : "https://www.oklink.com/x-layer-testnet/address";

  console.log(`\n${"─".repeat(60)}`);
  console.log("Update DEX_ROUTER_ADDRESS in root .env (agent), then restart the agent:");
  console.log(`   DEX_ROUTER_ADDRESS=${routerAddress}`);
  console.log(`\nExplorer: ${explorerBase}/${routerAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
