import hre from "hardhat";

/**
 * Verifies an already-deployed SableVault via the Sourcify v2 API (keyless).
 *
 *   SABLE_VAULT_ADDRESS=0x... npm run verify:testnet   # or verify:mainnet
 *
 * Why this talks to Sourcify directly instead of `hardhat verify`:
 *   - X Layer's OKLink explorer uses an `OK-ACCESS-KEY`-header verification API
 *     that the stock Etherscan plugin can't drive (it sends `?apikey=`), and it
 *     needs a header-compatible OKLink Explorer key.
 *   - Sourcify indexes X Layer mainnet (196) and testnet (1952) and is keyless,
 *     but @nomicfoundation/hardhat-verify@2.x calls Sourcify's now-deprecated
 *     API v1 (503 "Brownout"), and the v2-capable plugin (3.x) requires a full
 *     Hardhat 3 migration.
 * So we submit the compiler standard-JSON input (which Hardhat already produces)
 * to Sourcify v2 ourselves. Sourcify matches by metadata hash — no API key and
 * no constructor args required.
 */

const CONTRACT_FQN = "contracts/SableVault.sol:SableVault";
const SOURCIFY_API =
  (hre.config as any).sourcify?.apiUrl?.replace(/\/$/, "") || "https://sourcify.dev/server";

async function main() {
  const address = process.env.SABLE_VAULT_ADDRESS;
  if (!address) {
    throw new Error("Set SABLE_VAULT_ADDRESS in .env to the deployed vault address.");
  }
  const chainId = hre.network.config.chainId;
  if (!chainId) {
    throw new Error(`No chainId configured for network ${hre.network.name}.`);
  }

  // Already verified? Sourcify returns 200 with a match, or 404 if unknown.
  const existing = await fetch(`${SOURCIFY_API}/v2/contract/${chainId}/${address}`);
  if (existing.ok) {
    const body = (await existing.json()) as { match?: string | null };
    if (body.match) {
      console.log(`✅ Already verified on Sourcify (match: ${body.match}).`);
      console.log(`   https://repo.sourcify.dev/${chainId}/${address}`);
      return;
    }
  }

  // Ensure artifacts exist, then pull the exact standard-JSON input + solc version
  // Hardhat compiled with.
  await hre.run("compile");
  const buildInfo = await hre.artifacts.getBuildInfo(CONTRACT_FQN);
  if (!buildInfo) {
    throw new Error(`No build info for ${CONTRACT_FQN}. Run \`npm run compile\` first.`);
  }

  console.log(
    `Verifying ${address} on ${hre.network.name} (chainId ${chainId}) via Sourcify v2…`,
  );
  const submit = await fetch(`${SOURCIFY_API}/v2/verify/${chainId}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: buildInfo.input,
      compilerVersion: buildInfo.solcLongVersion,
      contractIdentifier: CONTRACT_FQN,
    }),
  });

  const submitBody = (await submit.json().catch(() => ({}))) as {
    verificationId?: string;
    error?: string;
    message?: string;
    customCode?: string;
  };

  // A contract already verified returns a 409-style error — treat as success.
  if (!submit.ok) {
    const msg = submitBody.message || submitBody.error || "";
    if (/already.*verified|conflict/i.test(msg) || submit.status === 409) {
      console.log(`✅ Already verified on Sourcify.`);
      console.log(`   https://repo.sourcify.dev/${chainId}/${address}`);
      return;
    }
    throw new Error(`Sourcify submission failed (HTTP ${submit.status}): ${msg}`);
  }

  const verificationId = submitBody.verificationId;
  if (!verificationId) {
    throw new Error(`Sourcify did not return a verificationId: ${JSON.stringify(submitBody)}`);
  }

  // Poll the job until it completes (or we give up after ~60s).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const jobRes = await fetch(`${SOURCIFY_API}/v2/verify/${verificationId}`);
    if (!jobRes.ok) continue;
    const job = (await jobRes.json()) as {
      isJobCompleted?: boolean;
      contract?: { match?: string | null };
      error?: { message?: string; customCode?: string };
    };
    if (!job.isJobCompleted) {
      process.stdout.write(".");
      continue;
    }
    process.stdout.write("\n");
    if (job.contract?.match) {
      console.log(`✅ Verified on Sourcify (match: ${job.contract.match}).`);
      console.log(`   https://repo.sourcify.dev/${chainId}/${address}`);
      return;
    }
    throw new Error(
      `Sourcify verification failed: ${job.error?.message ?? "no match"} (${
        job.error?.customCode ?? "unknown"
      })`,
    );
  }
  throw new Error(
    `Timed out polling Sourcify job ${verificationId}. Check https://repo.sourcify.dev/${chainId}/${address} later.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
