/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SABLE_VAULT_ADDRESS?: string;
  readonly VITE_AGENT_API_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_XLAYER_CHAIN_ID?: string;
  readonly VITE_XLAYER_RPC_URL?: string;
  readonly VITE_TOKEN_OKB_ADDRESS?: string;
  readonly VITE_TOKEN_USDC_ADDRESS?: string;
  readonly VITE_TOKEN_WETH_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
