/**
 * wagmi + RainbowKit config. A single connector set targeting X Layer. The
 * WalletConnect project ID is optional for injected wallets (MetaMask/OKX
 * Wallet) but required for the WalletConnect QR flow.
 */
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { xLayer } from "./chain";

export const wagmiConfig = getDefaultConfig({
  appName: "Sable",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "sable-dev",
  chains: [xLayer],
  ssr: false,
});
