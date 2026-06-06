"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useState, type ReactNode } from "react";
import {
  RainbowKitProvider,
  getDefaultConfig,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Web3 wiring lives here and ONLY here (plus the useIdentity wrapper). Screens
 * never import wagmi/RainbowKit directly — see FRONTEND_SPEC "provider-neutral".
 *
 * The wallet only IDENTIFIES the user; the backend signs all protocol txs with
 * RARE_PRIVATE_KEY. Chain is fixed to Sepolia.
 *
 * NEXT_PUBLIC_WALLETCONNECT_ID enables WalletConnect (mobile / many wallets).
 * Get a free id at https://cloud.reown.com and put it in .env.local. Without a
 * real id, injected wallets (e.g. MetaMask) still work for local dev; the
 * fallback below just lets the app boot (getDefaultConfig requires a non-empty
 * projectId — it throws on "").
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;
if (!projectId && typeof window !== "undefined") {
  console.warn(
    "[rare-forge] NEXT_PUBLIC_WALLETCONNECT_ID is not set. WalletConnect-based " +
      "wallets won't work; injected wallets (MetaMask) still will. Set a real id " +
      "from https://cloud.reown.com in .env.local."
  );
}

const wagmiConfig = getDefaultConfig({
  appName: "Rare Forge",
  projectId: projectId || "rare-forge-dev-placeholder",
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(),
  },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per app instance (stable across re-renders).
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#7c5cff",
            accentColorForeground: "#ffffff",
            borderRadius: "medium",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
