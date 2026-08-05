import { type FluentSession } from "@fluent.xyz/connect-sdk";
import { fluentTestnet } from "@fluent.xyz/connect-sdk";
import { type PrivyClientConfig } from "@privy-io/react-auth";

export const PRIVY_APP_ID = "cmi7li7v901yojv0dmtfuf0v4";
export const FLUENT_HOSTED_SESSION_ENDPOINT =
  import.meta.env.VITE_FLUENT_HOSTED_SESSION_ENDPOINT ?? "";
export const FLUENT_LOGO = "/fluent-assets/fluent-logo.svg";
export const ZERODEV_PROJECT_ID = "893acc63-da39-4b57-8789-5784ed7f1969";
export const hostedAuthorizePrivyConfig: PrivyClientConfig = {
  defaultChain: fluentTestnet,
  supportedChains: [fluentTestnet],
  // Reputation is keyed to an X account, so X is the only primary action and
  // email moves behind the overflow screen.
  loginMethodsAndOrder: { primary: ["twitter"], overflow: ["email"] },
  appearance: {
    theme: "dark",
    accentColor: "#FFFFFF",
    logo: FLUENT_LOGO,
    landingHeader: "Connect with Fluent",
    loginMessage: "Connect X to start building your Fluent reputation — badges, tiers, and perks.",
    showWalletLoginFirst: false,
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
    showWalletUIs: false,
  },
};

export type FluentWidgetSession = FluentSession & {
  clientId?: string;
  idToken: string;
  wallet: FluentSession["wallet"] & {
    signerAddress?: `0x${string}`;
    authorizationSession?: {
      expiresAt: number;
      serializedPermissionAccount: string;
      sessionPrivateKey: `0x${string}`;
      signerAddress: `0x${string}`;
    };
  };
  expiresAt?: number;
  metadata?: Record<string, string>;
};
