import { type FluentSession } from "@fluent/connect-sdk";
import { fluentTestnet } from "@fluent/wallet-sdk";
import { type PrivyClientConfig } from "@privy-io/react-auth";

export const PRIVY_APP_ID = "cmi7li7v901yojv0dmtfuf0v4";
export const FLUENT_HOSTED_SESSION_ENDPOINT =
  import.meta.env.VITE_FLUENT_HOSTED_SESSION_ENDPOINT ?? "";
export const FLUENT_LOGO = "/fluent-assets/fluent-logo.svg";
export const ZERODEV_PROJECT_ID = "893acc63-da39-4b57-8789-5784ed7f1969";
export const hostedAuthorizePrivyConfig: PrivyClientConfig = {
  defaultChain: fluentTestnet,
  supportedChains: [fluentTestnet],
  loginMethods: ["email", "wallet"],
  appearance: {
    landingHeader: "Log in with Fluent",
    loginMessage: "Use Fluent ID to continue.",
  },
  embeddedWallets: {
    createOnLogin: "users-without-wallets",
    showWalletUIs: true,
  },
};

export type FluentWidgetSession = FluentSession & {
  clientId?: string;
  idToken: string;
  wallet: FluentSession["wallet"] & {
    signerAddress?: `0x${string}`;
  };
  expiresAt?: number;
  metadata?: Record<string, string>;
};
