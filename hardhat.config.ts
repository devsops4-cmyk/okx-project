import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const {
  TESTNET_RPC_URL,
  MAINNET_RPC_URL,
  PRIVATE_KEY,
  OKLINK_API_KEY,
  XLAYER_TESTNET_CHAIN_ID,
} = process.env;

// ─── X Layer network parameters ──────────────────────────────────────────────
// Mainnet chain ID is 196 (0xc4).
//
// The TESTNET chain ID is disputed after the Aug-2025 OP-Stack re-architecture:
// OKX's own developer docs list 1952, while some third-party aggregators still
// list 195 (the old Polygon-CDK zkEVM value). We DEFAULT to the OKX-docs value
// and let you override it via XLAYER_TESTNET_CHAIN_ID in .env. Confirm at:
//   https://web3.okx.com/xlayer/docs/developer/build-on-xlayer/network-information
// A wrong chainId here causes every signed tx to be rejected by the RPC, so this
// is the single most important value to verify before deploying.
const XLAYER_MAINNET_CHAIN_ID = 196;
const XLAYER_TESTNET_CHAIN_ID_DEFAULT = 1952;

const testnetChainId = Number(XLAYER_TESTNET_CHAIN_ID || XLAYER_TESTNET_CHAIN_ID_DEFAULT);
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    xlayerTestnet: {
      url: TESTNET_RPC_URL || "https://testrpc.xlayer.tech/terigon",
      chainId: testnetChainId,
      accounts,
    },
    xlayerMainnet: {
      url: MAINNET_RPC_URL || "https://rpc.xlayer.tech",
      chainId: XLAYER_MAINNET_CHAIN_ID,
      accounts,
    },
  },
  // OKLink is X Layer's Etherscan-style verification backend. It requires an
  // OKLink *Explorer* API key sent as an `OK-ACCESS-KEY` header — note the stock
  // Etherscan plugin sends `?apikey=` instead, so OKLink verification via this
  // path needs a key OKLink accepts on that header. If you don't have one, use
  // Sourcify below (keyless) — it supports X Layer mainnet (196) and testnet
  // (1952) and is the default `npm run verify:*` path.
  etherscan: {
    apiKey: {
      xlayerTestnet: OKLINK_API_KEY || "",
      xlayerMainnet: OKLINK_API_KEY || "",
    },
    customChains: [
      {
        network: "xlayerTestnet",
        chainId: testnetChainId,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/xlayer-test/api",
          browserURL: "https://www.oklink.com/x-layer-testnet",
        },
      },
      {
        network: "xlayerMainnet",
        chainId: XLAYER_MAINNET_CHAIN_ID,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/xlayer/api",
          browserURL: "https://www.oklink.com/xlayer",
        },
      },
    ],
  },
  // Keyless verification. Sourcify indexes X Layer mainnet (196) and testnet
  // (1952); `scripts/verify.ts` uses this provider so verification works without
  // an OKLink API key.
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify.dev/server",
    browserUrl: "https://repo.sourcify.dev",
  },
};

export default config;
