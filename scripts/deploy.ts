import { ethers, network, run } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploys SableVault to the selected Hardhat network.
 *
 *   npm run deploy:testnet     # --network xlayerTestnet
 *   npm run deploy:mainnet     # --network xlayerMainnet
 *
 * Reads RPC + PRIVATE_KEY from .env (via hardhat.config.ts). Constructor args:
 *   INITIAL_OWNER  (default: deployer)  — can pause / rotate the agent
 *   AGENT_ADDRESS  (default: deployer)  — wallet allowed to call executeSwap
 *
 * After a successful deploy it prints the address, the OKLink explorer link, and
 * the exact env vars to copy into the agent + frontend configs.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  const initialOwner = process.env.INITIAL_OWNER || deployer.address;
  const agentAddress = process.env.AGENT_ADDRESS || deployer.address;

  console.log("─".repeat(60));
  console.log(`Network:   ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(balance)} OKB`);
  console.log(`Owner:     ${initialOwner}`);
  console.log(`Agent:     ${agentAddress}`);
  console.log("─".repeat(60));

  if (balance === 0n) {
    throw new Error(
      "Deployer has 0 OKB. Fund it from the faucet (https://web3.okx.com/xlayer/faucet) before deploying."
    );
  }

  const Vault = await ethers.getContractFactory("SableVault");
  const vault = await Vault.deploy(initialOwner, agentAddress);
  await vault.waitForDeployment();

  const address = await vault.getAddress();
  const explorer =
    network.name === "xlayerMainnet"
      ? `https://www.oklink.com/xlayer/address/${address}`
      : `https://www.oklink.com/x-layer-testnet/address/${address}`;

  console.log(`\n✅ SableVault deployed: ${address}`);
  console.log(`   Explorer: ${explorer}`);
  console.log(`\nAdd to your .env / configs:`);
  console.log(`   SABLE_VAULT_ADDRESS=${address}`);
  console.log(`   VITE_SABLE_VAULT_ADDRESS=${address}`);
  console.log(`\nVerify with:`);
  console.log(
    `   npx hardhat verify --network ${network.name} ${address} ${initialOwner} ${agentAddress}`
  );

  // Best-effort auto-verify when an OKLink key is present.
  if (process.env.OKLINK_API_KEY) {
    console.log("\nWaiting for a few confirmations before verifying…");
    await vault.deploymentTransaction()?.wait(5);
    try {
      await run("verify:verify", {
        address,
        constructorArguments: [initialOwner, agentAddress],
      });
      console.log("✅ Verified on OKLink.");
    } catch (e) {
      console.warn("Auto-verify failed (you can run the verify command above manually):");
      console.warn(e);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
