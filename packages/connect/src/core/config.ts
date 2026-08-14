import { fluent, fluentTestnet, type FluentSession } from "@fluent.xyz/connect-sdk";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { FLUENT_CONNECT_BUNDLED_ASSETS } from "../assets/brandAssets";
import type { FluentGasPaymentEthRates } from "./gasPayment";
import { resolveFluentWidgetNetworkFromEnv } from "./environment";
import {
  getFluentChainForNetwork,
  getFluentWidgetDefaultScopes,
  type FluentWidgetNetwork,
} from "./network";

export const FLUENT_CONNECT_PRIVY_APP_ID = "cmi7li7v901yojv0dmtfuf0v4";
export const FLUENT_CONNECT_REOWN_PROJECT_ID = "fbf7578f67b4a34e5101051131829ac0";
export const FLUENT_CONNECT_ZERODEV_PROJECT_ID = "893acc63-da39-4b57-8789-5784ed7f1969";
/** Public write-only PostHog project token — prints-xyz org, widget analytics only. */
export const FLUENT_CONNECT_POSTHOG_TOKEN = "phc_xr3QqFLEnKbDvmD5qsKvXuyaAdSkSKvcFGUH5VeDTLGD";
export const FLUENT_TESTNET_BLEND_TOKEN_ADDRESS = "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const;
export const FLUENT_TESTNET_USDNR_TOKEN_ADDRESS = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
export const FLUENT_MAINNET_BLEND_TOKEN_ADDRESS = "0x1385b8f55a84f2bda13eed4099d29eae03d553b2" as const;
export const FLUENT_MAINNET_USDNR_TOKEN_ADDRESS = "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9" as const;
export const FLUENT_CONNECT_TESTNET_PUBLIC_API_URL =
  "https://api.fluent-connect.dev.gblend.xyz/api/v1";
export const FLUENT_CONNECT_MAINNET_PUBLIC_API_URL =
  "";
// PostHog reverse proxy mounted at /ingest on the Fluent Connect service.
export const FLUENT_CONNECT_TESTNET_ANALYTICS_HOST =
  "https://api.fluent-connect.dev.gblend.xyz/ingest";
// Empty until the proxy reaches mainnet: it lives on the service's `devel` branch and
// `main` has no /ingest route, so a real URL here would make every production widget
// POST into a 404 forever.
export const FLUENT_CONNECT_MAINNET_ANALYTICS_HOST = "";
export const FLUENT_CONNECT_TESTNET_REPUTATION_SIGNUP_URL =
  "https://connect-preview.vercel.app/signin";
export const FLUENT_CONNECT_MAINNET_REPUTATION_SIGNUP_URL =
  "https://connect.fluent.xyz/signin";
export const FLUENT_CONNECT_TESTNET_AUTHORIZE_URL = "https://connect-preview.vercel.app/authorize";
export const FLUENT_CONNECT_MAINNET_AUTHORIZE_URL = "https://connect.fluent.xyz/authorize";
export const FLUENT_CONNECT_TESTNET_FAUCET_ENDPOINT =
  "https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund";
export const FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL = "https://portal.fluent.xyz/user/bridge";
export const FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG = {
  enabled: true,
  integratorId: "a5ece18d4332815e6480",
  dstChainId: "25363",
  dstTokenAddress: "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9",
};

/**
 * Infrastructure endpoints that must match the active chain. These are derived
 * from the widget network rather than accepted from the host app, so a widget
 * can never talk to a backend that disagrees with its chain.
 */
export type FluentWidgetNetworkEndpoints = {
  authorizeUrl: string;
  publicApiUrl: string;
  reputationSignupUrl: string;
  faucetEndpoint: string;
  bridgeUrl: string;
  /** PostHog reverse proxy. Empty disables analytics entirely for the network. */
  analyticsHost: string;
};

const FLUENT_CONNECT_NETWORK_ENDPOINTS: Record<FluentWidgetNetwork, FluentWidgetNetworkEndpoints> = {
  testnet: {
    authorizeUrl: FLUENT_CONNECT_TESTNET_AUTHORIZE_URL,
    publicApiUrl: FLUENT_CONNECT_TESTNET_PUBLIC_API_URL,
    reputationSignupUrl: FLUENT_CONNECT_TESTNET_REPUTATION_SIGNUP_URL,
    faucetEndpoint: FLUENT_CONNECT_TESTNET_FAUCET_ENDPOINT,
    bridgeUrl: FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL,
    analyticsHost: FLUENT_CONNECT_TESTNET_ANALYTICS_HOST,
  },
  // devnet mirrors testnet infrastructure.
  devnet: {
    authorizeUrl: FLUENT_CONNECT_TESTNET_AUTHORIZE_URL,
    publicApiUrl: FLUENT_CONNECT_TESTNET_PUBLIC_API_URL,
    reputationSignupUrl: FLUENT_CONNECT_TESTNET_REPUTATION_SIGNUP_URL,
    faucetEndpoint: FLUENT_CONNECT_TESTNET_FAUCET_ENDPOINT,
    bridgeUrl: FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL,
    analyticsHost: FLUENT_CONNECT_TESTNET_ANALYTICS_HOST,
  },
  mainnet: {
    authorizeUrl: FLUENT_CONNECT_MAINNET_AUTHORIZE_URL,
    publicApiUrl: FLUENT_CONNECT_MAINNET_PUBLIC_API_URL,
    reputationSignupUrl: FLUENT_CONNECT_MAINNET_REPUTATION_SIGNUP_URL,
    // Mainnet has no faucet.
    faucetEndpoint: "",
    bridgeUrl: FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL,
    analyticsHost: FLUENT_CONNECT_MAINNET_ANALYTICS_HOST,
  },
};

export function getFluentWidgetNetworkEndpoints(
  network: FluentWidgetNetwork,
): FluentWidgetNetworkEndpoints {
  return FLUENT_CONNECT_NETWORK_ENDPOINTS[network];
}

export const FLUENT_CONNECT_DEFAULT_ASSETS = {
  fluentLogo: FLUENT_CONNECT_BUNDLED_ASSETS.fluentLogo,
  walletConnectIcon: FLUENT_CONNECT_BUNDLED_ASSETS.walletConnectIcon,
  metamaskIcon: FLUENT_CONNECT_BUNDLED_ASSETS.metamaskIcon,
  coinbaseIcon: FLUENT_CONNECT_BUNDLED_ASSETS.coinbaseIcon,
} as const;

export { FLUENT_WIDGET_SESSION_STORAGE_KEY } from "./storageKeys";
export const FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY = "fluent:widget:identity-token:v1";
export const FLUENT_CONNECT_PRIVY_CONFIG: PrivyClientConfig = {
  defaultChain: fluentTestnet,
  supportedChains: [fluentTestnet],
  // Reputation is keyed to an X account, so X is the only primary action and
  // email moves behind the overflow screen.
  loginMethodsAndOrder: { primary: ["twitter"], overflow: ["email"] },
  appearance: {
    theme: "dark",
    accentColor: "#FFFFFF",
    logo: FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo,
    landingHeader: "",
    loginMessage: "Connect X to start building your Fluent reputation — badges, tiers, and perks.",
    showWalletLoginFirst: false,
    walletList: ["detected_wallets", "metamask", "coinbase_wallet", "rainbow", "wallet_connect"],
  },
  embeddedWallets: {
    createOnLogin: "users-without-wallets",
    showWalletUIs: false,
  },
};

export function createFluentConnectPrivyConfig(options: {
  network?: FluentWidgetNetwork;
  showWalletUIs: boolean;
  logo?: string;
}): PrivyClientConfig {
  const chain = getFluentChainForNetwork(options.network ?? "testnet");
  return {
    ...FLUENT_CONNECT_PRIVY_CONFIG,
    defaultChain: chain,
    supportedChains: [chain],
    appearance: {
      ...FLUENT_CONNECT_PRIVY_CONFIG.appearance,
      logo: options.logo ?? FLUENT_CONNECT_PRIVY_CONFIG.appearance?.logo,
    },
    embeddedWallets: {
      ...FLUENT_CONNECT_PRIVY_CONFIG.embeddedWallets,
      showWalletUIs: options.showWalletUIs,
    },
  };
}

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

/** Families render in this order regardless of how the API happens to key them. */
export const FLUENT_FAMILY_ORDER = [
  "identity",
  "predictor",
  "influential",
  "tester",
  "builder",
] as const;

export const FLUENT_FAMILY_DISPLAY_NAMES: Record<string, string> = {
  identity: "Human",
  predictor: "Predictor",
  influential: "Influence",
  tester: "Tester",
  builder: "Builder",
};

/** Gradient endpoints lifted from the Fluent Connect profile cards. */
export const FLUENT_FAMILY_ACCENTS: Record<string, { from: string; to: string }> = {
  identity: { from: "#1FE309", to: "#FF8FDA" },
  predictor: { from: "#FE6901", to: "#FECD07" },
  influential: { from: "#5011FF", to: "#32FE6B" },
  tester: { from: "#FE6A01", to: "#FF8FDA" },
  builder: { from: "#49EDED", to: "#FECD07" },
};

export const FLUENT_FAMILY_FALLBACK_ACCENT = { from: "#49EDED", to: "#FF8FDA" };

/** Tier A sits at the top of every family scale, tier D at the bottom. */
export const FLUENT_FAMILY_TIER_PROGRESS: Record<string, number> = {
  A: 100,
  B: 66,
  C: 33,
  D: 0,
};

export type FluentWidgetSession = FluentSession & {
  clientId?: string;
  idToken: string;
  wallet: Omit<FluentSession["wallet"], "smartAccountAddress"> & {
    smartAccountAddress: `0x${string}`;
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

export type FluentWidgetAuthMode = "hosted" | "direct";

export type FluentWidgetConfig = {
  clientId: string;
  network?: FluentWidgetNetwork;
  appName?: string;
  /**
   * `hosted` opens Fluent authorize in a popup (default).
   * `direct` opens Privy login modal in the host app — requires the host origin
   * to be registered in the Fluent Privy Allowed Origins.
   */
  authMode?: FluentWidgetAuthMode;
  swapper?: {
    enabled?: boolean;
    integratorId?: string;
    dstChainId?: string;
    dstTokenAddress?: string;
  };
  gasPayment?: {
    ethValueByToken?: FluentGasPaymentEthRates;
  };
  scopes?: string[];
  source?: string;
  campaign?: string;
  /** Turns off all analytics: PostHog is never initialised, nothing is sent or stored. */
  disableAnalytics?: boolean;
  assets?: Partial<typeof FLUENT_CONNECT_DEFAULT_ASSETS>;
};

export type ResolvedFluentWidgetConfig = {
  clientId: string;
  network: FluentWidgetNetwork;
  appName: string;
  authMode: FluentWidgetAuthMode;
  authorizeUrl: string;
  faucetEndpoint: string;
  eventsEndpoint: string;
  analyticsHost: string;
  disableAnalytics: boolean;
  publicApiUrl: string;
  reputationSignupUrl: string;
  bridgeUrl: string;
  swapper: {
    enabled: boolean;
    integratorId: string;
    dstChainId: string;
    dstTokenAddress: string;
  };
  gasPayment: {
    ethValueByToken: FluentGasPaymentEthRates | undefined;
  };
  scopes: string[];
  source: string;
  campaign: string | undefined;
  assets: typeof FLUENT_CONNECT_DEFAULT_ASSETS & Partial<typeof FLUENT_CONNECT_DEFAULT_ASSETS>;
};

export function resolveFluentWidgetConfig(config: FluentWidgetConfig): ResolvedFluentWidgetConfig {
  const clientId = config.clientId.trim();
  if (!clientId) {
    throw new Error(
      "FluentWidgetConfig.clientId is required. Pass the Fluent Connect app clientId from the host application.",
    );
  }

  const network = config.network ?? resolveFluentWidgetNetworkFromEnv() ?? "testnet";
  const endpoints = getFluentWidgetNetworkEndpoints(network);

  return {
    network,
    appName: config.appName ?? "Fluent Connect Demo",
    clientId,
    authMode: config.authMode ?? "hosted",
    authorizeUrl: endpoints.authorizeUrl,
    faucetEndpoint: endpoints.faucetEndpoint,
    eventsEndpoint: "",
    analyticsHost: endpoints.analyticsHost,
    disableAnalytics: config.disableAnalytics ?? false,
    publicApiUrl: endpoints.publicApiUrl,
    reputationSignupUrl: endpoints.reputationSignupUrl,
    bridgeUrl: endpoints.bridgeUrl,
    swapper: {
      enabled: config.swapper?.enabled ?? FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG.enabled,
      integratorId: config.swapper?.integratorId ?? FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG.integratorId,
      dstChainId: config.swapper?.dstChainId ?? FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG.dstChainId,
      dstTokenAddress:
        config.swapper?.dstTokenAddress ?? FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG.dstTokenAddress,
    },
    gasPayment: {
      ethValueByToken: config.gasPayment?.ethValueByToken,
    },
    scopes: config.scopes ?? getFluentWidgetDefaultScopes(network),
    source: config.source ?? "fluent_connect_widget",
    campaign: config.campaign,
    assets: {
      ...FLUENT_CONNECT_DEFAULT_ASSETS,
      ...config.assets,
    },
  };
}

export function createFluentConnectForWidget(config: FluentWidgetConfig) {
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
