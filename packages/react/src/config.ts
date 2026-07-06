import { fluent, type FluentSession } from "@fluent/connect-sdk";
import { fluentTestnet } from "@fluent/wallet-sdk";
import type { PrivyClientConfig } from "@privy-io/react-auth";

export const FLUENT_CONNECT_PRIVY_APP_ID = "cmi7li7v901yojv0dmtfuf0v4";
export const FLUENT_CONNECT_REOWN_PROJECT_ID = "fbf7578f67b4a34e5101051131829ac0";
export const FLUENT_CONNECT_ZERODEV_PROJECT_ID = "893acc63-da39-4b57-8789-5784ed7f1969";
export const FLUENT_TESTNET_BLEND_TOKEN_ADDRESS = "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const;
export const FLUENT_CONNECT_DEFAULT_PUBLIC_API_URL = "https://fluent-connect.api.fluent.xyz/api/v1";
export const FLUENT_CONNECT_DEFAULT_AUTHORIZE_URL = "https://connect.fluent.xyz/authorize";
export const FLUENT_CONNECT_DEFAULT_FAUCET_ENDPOINT =
  "https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund";
export const FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL = "https://portal.fluent.xyz/bridge";
export const FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG = {
  enabled: true,
  integratorId: "a5ece18d4332815e6480",
  dstChainId: "25363",
  dstTokenAddress: "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9",
};

export const FLUENT_CONNECT_DEFAULT_ASSETS = {
  fluentLogo: "/fluent-assets/fluent-logo.svg",
  walletConnectIcon: "/fluent-assets/walletconnect.svg",
  metamaskIcon: "/fluent-assets/metamask.svg",
  coinbaseIcon: "/fluent-assets/coinbase.svg",
} as const;

export const FLUENT_WIDGET_SESSION_STORAGE_KEY = "fluent:widget:session:v1";
export const FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY = "fluent:widget:identity-token:v1";
export const FLUENT_WIDGET_DEFAULT_SCOPES = ["openid", "profile", "wallet", "faucet", "families:read"];

export const FLUENT_CONNECT_PRIVY_CONFIG: PrivyClientConfig = {
  defaultChain: fluentTestnet,
  supportedChains: [fluentTestnet],
  loginMethods: ["email", "wallet"],
  appearance: {
    landingHeader: "Log in with Fluent",
    loginMessage: "Use Fluent ID to continue.",
  },
  embeddedWallets: {
    createOnLogin: "users-without-wallets",
    showWalletUIs: false,
  },
};

export const FLUENT_FAMILY_LABELS: Record<string, Record<string, string>> = {
  builder: {
    A: "My Quant",
    B: "Top Builder",
    C: "Dev-ish",
    D: "Not a Dev",
  },
  identity: {
    A: "Definitely Human",
    B: "Probably Human",
    C: "Maybe Human",
    D: "Probably Bot",
  },
  influential: {
    A: "Goated",
    B: "Seasoned Vet",
    C: "Sleeper Pick",
    D: "Undrafted",
  },
  predictor: {
    A: "Market Oracle",
    B: "Sharp Signal",
    C: "Early Read",
    D: "Unproven",
  },
  tester: {
    A: "Quality Tester",
    B: "Bug Hunter",
    C: "Early Tester",
    D: "Larpoor",
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

export type FluentWidgetConfig = {
  network?: "devnet" | "testnet" | "mainnet";
  appName?: string;
  clientId?: string;
  authorizeUrl?: string;
  faucetEndpoint?: string;
  eventsEndpoint?: string;
  publicApiUrl?: string;
  bridgeUrl?: string;
  swapper?: {
    enabled?: boolean;
    integratorId?: string;
    dstChainId?: string;
    dstTokenAddress?: string;
  };
  scopes?: string[];
  source?: string;
  campaign?: string;
  assets?: Partial<typeof FLUENT_CONNECT_DEFAULT_ASSETS>;
};

export type FluentEnv = Record<string, string | undefined>;

export function createFluentWidgetConfigFromEnv(env: FluentEnv): FluentWidgetConfig {
  return {
    network: "testnet",
    appName: env.VITE_FLUENT_APP_NAME ?? "Fluent Connect Demo",
    clientId: env.VITE_FLUENT_CLIENT_ID || undefined,
    authorizeUrl: env.VITE_FLUENT_AUTHORIZE_URL,
    faucetEndpoint: env.VITE_FLUENT_FAUCET_ENDPOINT,
    eventsEndpoint: env.VITE_FLUENT_EVENTS_ENDPOINT,
    publicApiUrl: env.VITE_FLUENT_PUBLIC_API_URL,
    bridgeUrl: env.VITE_FLUENT_BRIDGE_URL,
    swapper: {
      enabled: env.VITE_FLUENT_SWAPPER_ENABLED
        ? env.VITE_FLUENT_SWAPPER_ENABLED !== "false"
        : undefined,
      integratorId: env.VITE_FLUENT_SWAPPER_INTEGRATOR_ID,
      dstChainId: env.VITE_FLUENT_SWAPPER_DST_CHAIN_ID,
      dstTokenAddress: env.VITE_FLUENT_SWAPPER_DST_TOKEN_ADDRESS,
    },
    scopes: FLUENT_WIDGET_DEFAULT_SCOPES,
    source: "demo_widget",
    campaign: "hosted-connect-demo",
  };
}

export function resolveFluentWidgetConfig(config: FluentWidgetConfig = {}) {
  return {
    network: config.network ?? "testnet",
    appName: config.appName ?? "Fluent Connect Demo",
    clientId: config.clientId,
    authorizeUrl: config.authorizeUrl ?? FLUENT_CONNECT_DEFAULT_AUTHORIZE_URL,
    faucetEndpoint: config.faucetEndpoint ?? FLUENT_CONNECT_DEFAULT_FAUCET_ENDPOINT,
    eventsEndpoint: config.eventsEndpoint ?? "",
    publicApiUrl: config.publicApiUrl ?? FLUENT_CONNECT_DEFAULT_PUBLIC_API_URL,
    bridgeUrl: config.bridgeUrl ?? FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL,
    swapper: {
      ...FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG,
      ...config.swapper,
    },
    scopes: config.scopes ?? FLUENT_WIDGET_DEFAULT_SCOPES,
    source: config.source ?? "fluent_connect_widget",
    campaign: config.campaign,
    assets: {
      ...FLUENT_CONNECT_DEFAULT_ASSETS,
      ...config.assets,
    },
  };
}

export function createFluentConnectForWidget(config: FluentWidgetConfig = {}) {
  const resolved = resolveFluentWidgetConfig(config);
  return fluent.initialize({
    network: resolved.network,
    appName: resolved.appName,
    clientId: resolved.clientId,
    authorizeUrl: resolved.authorizeUrl,
    scopes: resolved.scopes,
    source: resolved.source,
    campaign: resolved.campaign,
  });
}
