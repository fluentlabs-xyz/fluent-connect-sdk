import { fluent, fluentTestnet, type FluentSession } from "@fluent.xyz/connect-sdk";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { isAddress, type Address } from "viem";
import { FLUENT_CONNECT_BUNDLED_ASSETS } from "../assets/brandAssets";
import { resolveDefaultGasToken, type FluentGasPaymentEthRates, type FluentGasTokenSymbol } from "./gasPayment";
import type { FluentAccountType } from "../widget/batchOperation";
import {
  getFluentChainForNetwork,
  getFluentWidgetDefaultScopes,
  type FluentWidgetNetwork,
} from "./network";

// A Privy app per network: each network's service verifies a Privy token against its own Privy
// app, so a mainnet widget signed in to the dev app would hand the production service a token
// it cannot verify.
export const FLUENT_CONNECT_TESTNET_PRIVY_APP_ID = "cmi7li7v901yojv0dmtfuf0v4";
export const FLUENT_CONNECT_MAINNET_PRIVY_APP_ID = "cmig3bvhd005hkz0c2q8vdg3s";
export const FLUENT_CONNECT_REOWN_PROJECT_ID = "fbf7578f67b4a34e5101051131829ac0";
// A ZeroDev project per network: each holds its own chains and paymaster policies, so mainnet
// does not spend the project the dev bench uses.
export const FLUENT_CONNECT_TESTNET_ZERODEV_PROJECT_ID = "893acc63-da39-4b57-8789-5784ed7f1969";
export const FLUENT_CONNECT_MAINNET_ZERODEV_PROJECT_ID = "216ca7d9-2b97-4894-ac23-7aa6a287dd97";
/** Public write-only PostHog project token — prints-xyz org, widget analytics only. */
export const FLUENT_CONNECT_POSTHOG_TOKEN = "phc_xr3QqFLEnKbDvmD5qsKvXuyaAdSkSKvcFGUH5VeDTLGD";
export const FLUENT_CONNECT_TESTNET_PUBLIC_API_URL = "https://api.fluent-connect.dev.gblend.xyz/api/v1";
// Production serves every connect and profile route under one base path (FLU-1616), so the
// public API and the sponsorship proxy share an origin and a prefix there.
export const FLUENT_CONNECT_MAINNET_PUBLIC_API_URL = "https://api.fluent.xyz/connect/v1";
// PostHog reverse proxy mounted at /ingest on the Fluent Connect service.
export const FLUENT_CONNECT_TESTNET_ANALYTICS_HOST =
  "https://api.fluent-connect.dev.gblend.xyz/ingest";
export const FLUENT_CONNECT_MAINNET_ANALYTICS_HOST = "https://api.fluent.xyz/connect/v1/ingest";
// App-funded gas sponsorship proxy (FLU-1128).
export const FLUENT_CONNECT_TESTNET_SPONSORSHIP_URL =
  "https://sponsorship.fluent-connect.dev.gblend.xyz";
export const FLUENT_CONNECT_MAINNET_SPONSORSHIP_URL = "https://api.fluent.xyz/connect/v1";
export const FLUENT_CONNECT_TESTNET_REPUTATION_SIGNUP_URL =
  "https://connect-preview.vercel.app/signin";
export const FLUENT_CONNECT_MAINNET_REPUTATION_SIGNUP_URL =
  "https://connect.fluent.xyz/signin";
export const FLUENT_CONNECT_TESTNET_FAUCET_ENDPOINT =
  "https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund";
// Quick sign ("silent signing") is on out of the box. The wallet-menu toggle is the
// opt-out, and for a Fluent ID the service keeps it (`PATCH /me/settings`), so a page
// session starts from this value only until that read lands. It stays on it wherever the
// preference is not kept: an External wallet, which neither applies nor writes it, and the
// state where no Fluent token can exist — nobody connected.
export const FLUENT_CONNECT_DEFAULT_SILENT_SIGNING = true;
/**
 * How a smart-account send is executed out of the box: fees and inclusion read from the widget
 * chain, no chain check before a signature (FLU-1591).
 *
 * The same values on both networks. Each source falls back to ZeroDev on its own, inside the
 * send that needed it, so a chain RPC that fails — after its own transport's retries — costs
 * the send latency rather than its receipt.
 */
export const FLUENT_CONNECT_DEFAULT_EXECUTION = {
  feeSource: "chain",
  receiptSource: "chain",
  chainCheckBeforeSign: false,
} as const satisfies ResolvedFluentWidgetExecution;
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
  publicApiUrl: string;
  reputationSignupUrl: string;
  faucetEndpoint: string;
  bridgeUrl: string;
  /** PostHog reverse proxy. Empty disables analytics entirely for the network. */
  analyticsHost: string;
  /** Gas sponsorship proxy. Empty disables sponsorship for the network. */
  sponsorshipUrl: string;
};

const FLUENT_CONNECT_NETWORK_ENDPOINTS: Record<FluentWidgetNetwork, FluentWidgetNetworkEndpoints> = {
  testnet: {
    publicApiUrl: FLUENT_CONNECT_TESTNET_PUBLIC_API_URL,
    reputationSignupUrl: FLUENT_CONNECT_TESTNET_REPUTATION_SIGNUP_URL,
    faucetEndpoint: FLUENT_CONNECT_TESTNET_FAUCET_ENDPOINT,
    bridgeUrl: FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL,
    analyticsHost: FLUENT_CONNECT_TESTNET_ANALYTICS_HOST,
    sponsorshipUrl: FLUENT_CONNECT_TESTNET_SPONSORSHIP_URL,
  },
  mainnet: {
    publicApiUrl: FLUENT_CONNECT_MAINNET_PUBLIC_API_URL,
    reputationSignupUrl: FLUENT_CONNECT_MAINNET_REPUTATION_SIGNUP_URL,
    // Mainnet has no faucet.
    faucetEndpoint: "",
    bridgeUrl: FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL,
    analyticsHost: FLUENT_CONNECT_MAINNET_ANALYTICS_HOST,
    sponsorshipUrl: FLUENT_CONNECT_MAINNET_SPONSORSHIP_URL,
  },
};

export function getFluentWidgetNetworkEndpoints(
  network: FluentWidgetNetwork,
): FluentWidgetNetworkEndpoints {
  return FLUENT_CONNECT_NETWORK_ENDPOINTS[network];
}

const FLUENT_CONNECT_ZERODEV_PROJECT_IDS: Record<FluentWidgetNetwork, string> = {
  testnet: FLUENT_CONNECT_TESTNET_ZERODEV_PROJECT_ID,
  mainnet: FLUENT_CONNECT_MAINNET_ZERODEV_PROJECT_ID,
};

/** The ZeroDev project a widget on `network` derives its smart account and its RPC URL from. */
export function getFluentZeroDevProjectId(network: FluentWidgetNetwork): string {
  return FLUENT_CONNECT_ZERODEV_PROJECT_IDS[network];
}

const FLUENT_CONNECT_PRIVY_APP_IDS: Record<FluentWidgetNetwork, string> = {
  testnet: FLUENT_CONNECT_TESTNET_PRIVY_APP_ID,
  mainnet: FLUENT_CONNECT_MAINNET_PRIVY_APP_ID,
};

/** The Privy app a widget on `network` signs a person in through. */
export function getFluentPrivyAppId(network: FluentWidgetNetwork): string {
  return FLUENT_CONNECT_PRIVY_APP_IDS[network];
}

/**
 * Images for the widget, each a URL or a data URI. Today the widget reads only `fluentLogo`,
 * which it passes to the provider behind Direct login as its logo; see `assets` in
 * [configuration.md](configuration.md).
 */
export type FluentWidgetAssets = {
  /** The Fluent mark. */
  fluentLogo: string;
  /** The WalletConnect icon. */
  walletConnectIcon: string;
  /** The MetaMask icon. */
  metamaskIcon: string;
  /** The Coinbase Wallet icon. */
  coinbaseIcon: string;
};

export const FLUENT_CONNECT_DEFAULT_ASSETS: FluentWidgetAssets = {
  fluentLogo: FLUENT_CONNECT_BUNDLED_ASSETS.fluentLogo,
  walletConnectIcon: FLUENT_CONNECT_BUNDLED_ASSETS.walletConnectIcon,
  metamaskIcon: FLUENT_CONNECT_BUNDLED_ASSETS.metamaskIcon,
  coinbaseIcon: FLUENT_CONNECT_BUNDLED_ASSETS.coinbaseIcon,
};

export { FLUENT_WIDGET_SESSION_STORAGE_KEY } from "./storageKeys";
export const FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY = "fluent:widget:identity-token:v1";
export const FLUENT_CONNECT_PRIVY_CONFIG: PrivyClientConfig = {
  defaultChain: fluentTestnet,
  supportedChains: [fluentTestnet],
  // Keep X first, followed by Google; email remains available in the overflow.
  loginMethodsAndOrder: { primary: ["twitter", "google"], overflow: ["email"] },
  appearance: {
    theme: "dark",
    accentColor: "#FFFFFF",
    logo: FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo,
    landingHeader: "",
    loginMessage: "Connect X to start building your Fluent reputation — badges, tiers, and perks.",
    showWalletLoginFirst: false,
    walletList: ["detected_wallets", "metamask", "coinbase_wallet", "rainbow"],
  },
  /**
   * WalletConnect in this widget belongs to Reown/AppKit, which builds it once
   * per page (`appKitByKey` in `widget/reownAppKit.tsx`). Privy builds its own
   * on every `PrivyProvider` mount and never tears it down, so with Quick sign
   * keying that provider the count of `new Core()` calls grew with every
   * toggle. Leaving the one owner that is built once is what bounds it.
   *
   * `appearance.walletList` drops `wallet_connect` for the same reason: Privy
   * filters WalletConnect-backed entries out of its own modal once this is off,
   * so naming it there would promise a route that no longer exists.
   */
  externalWallets: { walletConnect: { enabled: false } },
  /**
   * Constant on purpose, not derived from Quick sign.
   *
   * Privy resolves this once when `PrivyProvider` mounts and does not pick up a
   * later change to the `config` prop — which is why Quick sign used to key that
   * provider and rebuild everything below it. Neither signer mode shows Privy's
   * confirmation screen: Prompt mode is confirmed in the widget's own review,
   * and its signer still names `uiOptions.showWalletUIs: false` per call, which
   * wins over this.
   */
  embeddedWallets: {
    createOnLogin: "users-without-wallets",
    showWalletUIs: false,
  },
};

/**
 * Everything here is fixed for the widget's lifetime. Nothing a person can
 * change from the account menu belongs in it: Privy reads this config once per
 * mount, so a value that varies would need a remount to apply.
 */
export function createFluentConnectPrivyConfig(options: {
  network?: FluentWidgetNetwork;
  logo?: string;
  customOAuthRedirectUrl?: string;
}): PrivyClientConfig {
  const chain = getFluentChainForNetwork(options.network ?? "testnet");
  return {
    ...FLUENT_CONNECT_PRIVY_CONFIG,
    defaultChain: chain,
    supportedChains: [chain],
    ...(options.customOAuthRedirectUrl && {
      customOAuthRedirectUrl: options.customOAuthRedirectUrl,
    }),
    appearance: {
      ...FLUENT_CONNECT_PRIVY_CONFIG.appearance,
      logo: options.logo ?? FLUENT_CONNECT_PRIVY_CONFIG.appearance?.logo,
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

/**
 * The session the widget keeps for itself in browser storage, under
 * `FLUENT_WIDGET_SESSION_STORAGE_KEY`. Internal: it carries the login's subject and identity
 * token, so the widget's API hands a host only its projection, a `FluentWidgetSession`
 * (`toFluentWidgetSession`). The storage is the App's origin storage, which any script on the
 * page can read, so no secret may be stored in it.
 */
export type FluentStoredSession = FluentSession & {
  appId?: string;
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

/**
 * What the widget tells an App about who is signed in: the Widget account's address and type,
 * and when the widget built that snapshot. Not a credential: an App proves who the person is
 * with an Auth token from `getAuthToken()`.
 *
 * Only a Fluent ID's Direct login writes a session. Connecting an External wallet neither writes nor
 * clears it; read the connected account from `widget.account`.
 */
export type FluentWidgetSession = {
  account: {
    /** The Fluent ID's smart account address. */
    address: Address;
    /**
     * `"smart"`: today a session is only ever a Fluent ID's. `FluentAccountType` may gain
     * values, so a `switch` over it keeps a `default` branch.
     */
    type: FluentAccountType;
  };
  /**
   * The local time the widget built the snapshot, in Unix seconds from the browser's clock; not
   * a time the service attests. A session restored on a later page load keeps that time.
   */
  issuedAt: number;
};

/**
 * The one projection from the stored session to what a host receives: the allowlisted fields,
 * copied, so no other field of the stored object is reachable through the widget's API. Every
 * boundary that hands a session to the host goes through it (`onSessionChange`, the render
 * context and `useFluentWidget()`). The stored session itself sits in the App's origin storage,
 * readable by any script on the page, so no secret may be stored in it.
 *
 * `null` when the stored session is missing or malformed: its address is not a string address,
 * or its `issuedAt` is not a finite number.
 */
export function toFluentWidgetSession(
  stored: FluentStoredSession | null,
): FluentWidgetSession | null {
  // The one check of a stored session's fields: `hydrateSession` runs it on a restored session
  // and discards one it rejects, and the projection keeps it so it holds for any input.
  const address: unknown = stored?.wallet?.smartAccountAddress;
  const issuedAt: unknown = stored?.issuedAt;
  if (typeof address !== "string" || !isAddress(address, { strict: false })) return null;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;
  return {
    // The widget stores a session only at Direct login, so it is always a Fluent ID's.
    account: { address, type: "smart" },
    issuedAt,
  };
}

/**
 * A sign-in method the sign-in dialog can offer beside X. X is not on this list:
 * it is always offered and cannot be switched off.
 */
export type FluentWidgetAuthMethod = "google" | "email" | "passkey";

/** On out of the box, and the order the dialog shows them in by default. */
export const FLUENT_CONNECT_DEFAULT_AUTH_METHODS = [
  "google",
  "email",
  "passkey",
] as const satisfies readonly FluentWidgetAuthMethod[];

/**
 * The methods the dialog shows beside X, in the host's own order. Unknown values and
 * duplicates are dropped; an empty list is honoured and leaves X alone, so the absent
 * case (`undefined`) is the only one that falls back to the defaults.
 */
export function resolveFluentWidgetAuthMethods(
  enabledAuthMethods?: readonly FluentWidgetAuthMethod[],
): FluentWidgetAuthMethod[] {
  if (!enabledAuthMethods) return [...FLUENT_CONNECT_DEFAULT_AUTH_METHODS];
  if (!isIterable(enabledAuthMethods)) {
    throw new FluentWidgetConfigError(
      "invalid_option",
      `FluentWidgetConfig.enabledAuthMethods ${describeRejectedValue(enabledAuthMethods)} is not ` +
        "a list. Pass an array of login methods, or leave it unset for the defaults.",
    );
  }
  const enabled = new Set<FluentWidgetAuthMethod>();
  for (const method of enabledAuthMethods) {
    if (FLUENT_CONNECT_DEFAULT_AUTH_METHODS.includes(method)) enabled.add(method);
  }
  return [...enabled];
}

/**
 * Which value in `FluentWidgetConfig` was refused, for a host that branches rather than reads
 * the message.
 */
export type FluentWidgetConfigErrorCode =
  | "invalid_fee_source"
  | "invalid_receipt_source"
  | "invalid_chain_check_before_sign"
  /** A required option is absent or empty. */
  | "missing_option"
  /** An option holds a value the widget cannot use. */
  | "invalid_option"
  /** An option an earlier release removed or renamed is still passed. */
  | "removed_option";

/**
 * A value in `FluentWidgetConfig` the widget refuses to start with.
 *
 * Thrown when `<FluentWidget>` renders with a config it has not resolved yet: on its first
 * render, and again on any render that passes a new `config` object. So it surfaces at startup
 * where the integrator is looking rather than at the first send. The message names the option and
 * how to fix it; `code`, a `FluentWidgetConfigErrorCode`, is what to branch on.
 *
 * @example
 * ```tsx
 * import { FluentWidgetConfigError } from "@fluent.xyz/connect";
 *
 * export function WidgetBoundaryFallback({ error }: { error: unknown }) {
 *   // More than one option is required, and the message names the one that is missing.
 *   if (error instanceof FluentWidgetConfigError && error.code === "missing_option") {
 *     return <p>The widget config is missing a required option: {error.message}</p>;
 *   }
 *   throw error;
 * }
 * ```
 */
export class FluentWidgetConfigError extends Error {
  readonly code: FluentWidgetConfigErrorCode;

  constructor(code: FluentWidgetConfigErrorCode, message: string) {
    super(message);
    this.name = "FluentWidgetConfigError";
    this.code = code;
  }
}

/**
 * Where a Fluent ID's send reads a value it could ask either side for: the widget chain's own
 * RPC, or the bundler.
 *
 * @experimental May change or be removed in a minor release while the defaults are measured;
 * the defaults are the recommended setting.
 */
export type FluentWidgetExecutionSource = "chain" | "bundler";

/**
 * `FluentWidgetConfig.execution`, every field optional.
 *
 * @experimental May change or be removed in a minor release while the defaults are measured;
 * the defaults are the recommended setting.
 */
export type FluentWidgetExecution = {
  /**
   * Where the fees of a user operation come from, a `FluentWidgetExecutionSource`. `chain` reads
   * the widget chain's `eth_gasPrice` and caps `maxFeePerGas` 10 % above it; `bundler` takes the
   * bundler's own gas price quote unchanged. Defaults to `chain`.
   *
   * @experimental May change or be removed in a minor release while the defaults are
   * measured; the defaults are the recommended setting.
   */
  feeSource?: FluentWidgetExecutionSource;
  /**
   * Where inclusion is read from, a `FluentWidgetExecutionSource`. `chain` polls the
   * EntryPoint's `UserOperationEvent` with `eth_getLogs`; `bundler` polls
   * `eth_getUserOperationReceipt`. Defaults to `chain`.
   *
   * @experimental May change or be removed in a minor release while the defaults are
   * measured; the defaults are the recommended setting.
   */
  receiptSource?: FluentWidgetExecutionSource;
  /**
   * Whether the Signer's chain is read before every signature. The widget gives the Signer's
   * provider its own chain as the only one, and the smart account checks the chain once when it
   * is created, so the repeat costs a provider round trip per signature and switches nothing.
   * Defaults to `false`.
   *
   * @experimental May change or be removed in a minor release while the defaults are
   * measured; the defaults are the recommended setting.
   */
  chainCheckBeforeSign?: boolean;
};

/** `FluentWidgetExecution` with its defaults applied. Internal. */
export type ResolvedFluentWidgetExecution = {
  feeSource: FluentWidgetExecutionSource;
  receiptSource: FluentWidgetExecutionSource;
  chainCheckBeforeSign: boolean;
};

/** The configuration of one `<FluentWidget>`, fixed for the App's deployment. */
export type FluentWidgetConfig = {
  /** The App's id (`app_<32 hex>`) — the same string the Fluent Dashboard shows and the token's `aud` carries. */
  appId: string;
  /**
   * The Privy app client issued by Fluent for this App. Login configuration, not
   * identity: it carries the allowed origins for Privy login, while `appId` is what
   * sponsorship, auth and analytics speak. Required while login runs on Privy.
   *
   * @experimental May change or be removed in a minor release: it exists while login runs on
   * Privy, and goes when Fluent's own login replaces it.
   */
  privyClientId: string;
  /** Removed in 0.2.0 — the type exists only so the error names the fix. */
  clientId?: never;
  /** Renamed to `appId` in 0.3.0 — the type exists only so the error names the fix. */
  partnerId?: never;
  /**
   * The Network the widget runs on. It picks the chain, the funds, the login app, the account
   * project and the service, so the App names it: the widget reads no environment variable for
   * it and has no default.
   */
  network: FluentWidgetNetwork;
  appName?: string;
  /**
   * An HTTPS URL passed to the provider behind Direct login as its OAuth redirect URL. When to
   * use it: [experimental.md](experimental.md#customoauthredirecturl).
   *
   * @experimental May change or be removed in a minor release: it configures the redirect of
   * the login provider the widget runs on today.
   */
  customOAuthRedirectUrl?: string;
  /**
   * Sign-in methods the sign-in dialog offers beside X, in the order given.
   * Defaults to `["google", "email", "passkey"]` — all of them; name a shorter
   * set to drop the rest, or `[]` to leave X as the only Fluent method.
   * Sign-in with X is always offered and is not a value here.
   *
   * A method still has to be enabled for the App by Fluent — listing it here only decides
   * whether its button is drawn.
   */
  enabledAuthMethods?: FluentWidgetAuthMethod[];
  /**
   * The swap entry in the account drawer.
   *
   * @experimental May change or be removed in a minor release while the defaults are measured;
   * the defaults are the recommended setting.
   */
  swapper?: {
    enabled?: boolean;
    integratorId?: string;
    dstChainId?: string;
    dstTokenAddress?: string;
  };
  gasPayment?: {
    /** Initial/fallback token. Defaults to ETH; a valid saved user choice wins. */
    defaultToken?: FluentGasTokenSymbol;
    /** Native-gas sponsorship policy. Defaults to `auto`; `never` skips the paymaster. */
    sponsorship?: "auto" | "never";
    /**
     * What one unit of each Gas token is worth in ETH, a `FluentGasPaymentEthRates` keyed by
     * `FluentGasTokenSymbol`, for the cost the widget shows beside each Gas token.
     *
     * @experimental May change or be removed in a minor release while the defaults are
     * measured; the defaults are the recommended setting.
     */
    ethValueByToken?: FluentGasPaymentEthRates;
  };
  /**
   * How a Fluent ID's send is executed: a `FluentWidgetExecution`, each of whose sources is a
   * `FluentWidgetExecutionSource`. Every field defaults to the fast path, which falls back to
   * the bundler on its own: set a field to switch that one answer to the bundler for good.
   *
   * @experimental May change or be removed in a minor release while the defaults are
   * measured; the defaults are the recommended setting.
   */
  execution?: FluentWidgetExecution;
  quickSign?: {
    /**
     * Call targets Quick sign may execute without the Review. With a list set, a Batch
     * operation runs in Silent mode only when every call's `to` is on it; a single call to any
     * other address shows the Review, even with Quick sign on. An
     * empty list is honoured and stops Quick sign from silencing anything; omit the
     * option to keep it covering every address. Compared case-insensitively.
     * `signMessage` / `signTypedData` have no call target and are not scoped by this.
     */
    whitelistAddresses?: readonly string[];
  };
  /**
   * `false` drops the Reputation tab from the account drawer — and with it the
   * whole tab strip, since Home is then the only tab. The families request is
   * never made. Default `true`.
   */
  reputationEnabled?: boolean;
  source?: string;
  campaign?: string;
  /** Turns off all analytics: PostHog is never initialised, nothing is sent or stored. */
  disableAnalytics?: boolean;
  /** Restore injected wallets and WalletConnect by default; true restores all, false restores none. */
  reconnectOnMount?: boolean;
  /**
   * Point the widget at a sponsorship service other than the network default. Local
   * development only: the deployed URL is the one every real integration should use.
   *
   * @experimental May change or be removed in a minor release while the defaults are measured;
   * the defaults are the recommended setting.
   */
  sponsorshipUrl?: string;
  /**
   * `getAuthToken()` reuses a token until this many seconds before its `exp`, then fetches a
   * fresh one (the renewal-offset pattern: MSAL's `tokenRenewalOffsetSeconds`, Go oauth2's
   * `expiryDelta`). Default 30. Set 0 to drop the margin entirely: a token is then reused
   * until `exp` itself, which is not the same as always fetching — it is the case the margin
   * exists for, a token handed out a moment before it expires and rejected by the backend it
   * is sent to.
   */
  authTokenRenewalOffsetSeconds?: number;
  /** Images for the widget; see `FluentWidgetAssets`. */
  assets?: Partial<FluentWidgetAssets>;
  /** The account avatar shown on the connect button and in the account drawer. */
  avatar?: {
    /**
     * Image used when there is no X avatar to show — a URL or a data URI.
     * Defaults to the Fluent mark.
     */
    defaultLogoUrl?: string;
    /**
     * Always show `defaultLogoUrl`, even for users who signed in with X.
     * Default `false` (the linked X picture wins when the person has one).
     */
    forceDefault?: boolean;
  };
};

export type ResolvedFluentWidgetConfig = {
  appId: string;
  privyClientId: string;
  network: FluentWidgetNetwork;
  appName: string;
  customOAuthRedirectUrl: string | undefined;
  /** What the dialog shows beside X, defaults applied. */
  authMethods: FluentWidgetAuthMethod[];
  faucetEndpoint: string;
  eventsEndpoint: string;
  analyticsHost: string;
  sponsorshipUrl: string;
  authTokenRenewalOffsetSeconds: number;
  disableAnalytics: boolean;
  reconnectOnMount: boolean | undefined;
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
    defaultToken: FluentGasTokenSymbol;
    sponsorship: "auto" | "never";
    ethValueByToken: FluentGasPaymentEthRates | undefined;
  };
  execution: ResolvedFluentWidgetExecution;
  quickSign: {
    /** Lowercased and deduplicated; `undefined` leaves Quick sign covering every address. */
    whitelistAddresses: readonly Address[] | undefined;
  };
  reputationEnabled: boolean;
  scopes: string[];
  source: string;
  campaign: string | undefined;
  assets: FluentWidgetAssets;
  avatar: {
    defaultLogoUrl: string | undefined;
    forceDefault: boolean;
  };
};

/** The only shape the service mints (ADR 0002's prefixed-text rule with the `app_` prefix). */
const APP_ID_PATTERN = /^app_[0-9a-f]{32}$/;
const APP_ID_HINT = "Pass the app_<32 hex> id from the Fluent Dashboard as appId.";
const NETWORK_HINT =
  'Pass "testnet" or "mainnet" as network; the widget reads no environment variable for it.';

function resolveCustomOAuthRedirectUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const hint =
    "FluentWidgetConfig.customOAuthRedirectUrl must be an absolute HTTPS URL " +
    "without credentials, query parameters, or a fragment. Register the exact URL in Privy.";
  if (typeof value !== "string") throw new FluentWidgetConfigError("invalid_option", hint);
  const redirectUrl = value.trim();
  if (!redirectUrl) return undefined;
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    throw new FluentWidgetConfigError("invalid_option", hint);
  }
  if (
    !/^https:\/\//i.test(redirectUrl) ||
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    redirectUrl.includes("?") ||
    redirectUrl.includes("#")
  ) {
    throw new FluentWidgetConfigError("invalid_option", hint);
  }
  // Preserve the exact allowlisted spelling rather than normalizing its path.
  return redirectUrl;
}

/**
 * Lowercased so execution compares targets without caring how the host spelled them.
 * A malformed entry dies loudly at startup: a typo that was silently dropped would
 * widen nothing, but every operation meant to be silent would review instead, and
 * nothing would say why.
 */
function resolveQuickSignWhitelist(
  addresses: readonly string[] | undefined,
): readonly Address[] | undefined {
  if (addresses === undefined) return undefined;
  if (!isIterable(addresses)) {
    throw new FluentWidgetConfigError(
      "invalid_option",
      `FluentWidgetConfig.quickSign.whitelistAddresses ${describeRejectedValue(addresses)} is ` +
        "not a list. Pass an array of 0x-prefixed 20-byte addresses.",
    );
  }
  const resolved = new Set<Address>();
  for (const value of addresses) {
    const address = typeof value === "string" ? value.trim() : "";
    if (!isAddress(address, { strict: false })) {
      throw new FluentWidgetConfigError(
        "invalid_option",
        "FluentWidgetConfig.quickSign.whitelistAddresses contains " +
          `${describeRejectedValue(value)}, which is not an address. ` +
          "Pass 0x-prefixed 20-byte addresses.",
      );
    }
    resolved.add(address.toLowerCase() as Address);
  }
  return [...resolved];
}

const EXECUTION_SOURCES = ["chain", "bundler"] as const;

/**
 * The three execution switches, each absent value taking the default.
 *
 * A value outside the two sources, or a `chainCheckBeforeSign` that is not a boolean, dies here
 * rather than at the first send: the fast path and the ZeroDev path both work, so a typo would
 * otherwise be invisible — the widget would quietly keep the default and the host would read its
 * own configuration as applied.
 */
function resolveFluentWidgetExecution(
  execution: FluentWidgetExecution | undefined,
): ResolvedFluentWidgetExecution {
  return {
    feeSource: resolveExecutionSource(
      execution?.feeSource,
      "feeSource",
      "invalid_fee_source",
      FLUENT_CONNECT_DEFAULT_EXECUTION.feeSource,
    ),
    receiptSource: resolveExecutionSource(
      execution?.receiptSource,
      "receiptSource",
      "invalid_receipt_source",
      FLUENT_CONNECT_DEFAULT_EXECUTION.receiptSource,
    ),
    chainCheckBeforeSign: resolveChainCheckBeforeSign(execution?.chainCheckBeforeSign),
  };
}

function resolveExecutionSource(
  value: unknown,
  field: "feeSource" | "receiptSource",
  code: FluentWidgetConfigErrorCode,
  fallback: FluentWidgetExecutionSource,
): FluentWidgetExecutionSource {
  if (value === undefined) return fallback;
  if (value === "chain" || value === "bundler") return value;
  throw new FluentWidgetConfigError(
    code,
    `FluentWidgetConfig.execution.${field} ${describeRejectedValue(value)} is not supported. ` +
      `Pass one of ${EXECUTION_SOURCES.map((source) => JSON.stringify(source)).join(" or ")}.`,
  );
}

function resolveChainCheckBeforeSign(value: unknown): boolean {
  if (value === undefined) return FLUENT_CONNECT_DEFAULT_EXECUTION.chainCheckBeforeSign;
  if (typeof value === "boolean") return value;
  throw new FluentWidgetConfigError(
    "invalid_chain_check_before_sign",
    `FluentWidgetConfig.execution.chainCheckBeforeSign ${describeRejectedValue(value)} is ` +
      "not a boolean. Pass true to read the Signer's chain before every signature, or false.",
  );
}

/**
 * How a rejected config value is named back to the host. `JSON.stringify` cannot do it, and
 * neither can `String` alone: the values these validators exist to reject include the ones they
 * refuse to convert — a bigint or a cycle raises a `TypeError` in `JSON.stringify`, an object
 * whose `toString` is not a function raises one in `String` — and that `TypeError` would reach
 * the host in place of the `FluentWidgetConfigError` the guide promises, naming neither the
 * option nor a code to branch on [seen: FLU-1591].
 */
function describeRejectedValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  try {
    // `String` is the one conversion a symbol survives; a template literal throws on it.
    return `${typeof value} ${String(value)}`;
  } catch {
    // An object whose own `toString` throws still has a type, and the field is what matters.
    return typeof value;
  }
}

/** Whether `for...of` can walk `value`; a JavaScript host can pass a value the type forbids. */
function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    value !== undefined &&
    value !== null &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  );
}

/**
 * A string option, trimmed, an absent one read as empty. A JavaScript host can pass any other
 * value, on which `trim` would raise a `TypeError` that names no option.
 */
function readStringOption(value: unknown, option: string, hint: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  throw new FluentWidgetConfigError(
    "invalid_option",
    `FluentWidgetConfig.${option} ${describeRejectedValue(value)} is not a string. ${hint}`,
  );
}

/**
 * The Gas token the widget charges until the person chooses one. A symbol no Gas token on
 * `network` has dies at startup: a widget that quietly charged ETH instead would read as the
 * host's choice applied.
 */
function resolveGasPaymentDefaultToken(
  network: FluentWidgetNetwork,
  value: unknown,
): FluentGasTokenSymbol {
  const token =
    value === undefined || typeof value === "string"
      ? resolveDefaultGasToken(network, value)
      : undefined;
  if (token) return token;
  throw new FluentWidgetConfigError(
    "invalid_option",
    `FluentWidgetConfig.gasPayment.defaultToken ${describeRejectedValue(value)} is not a Gas ` +
      `token on ${network}. Pass the symbol of one, such as "ETH", or leave it unset for ETH.`,
  );
}

/**
 * One page load, one migration notice. The key is a property of the App's config, not of
 * the call that reads it, and a single mount reads the same config three times — in
 * `FluentWidget`, in `FluentWidgetContent` and in the widget's own `fluent` instance — before
 * any re-render. Three identical lines in the console read as three separate problems.
 */
let legacyAuthModeWarned = false;

/**
 * The 0.4.x `authMode` key, read off a config the type no longer has it on. Every
 * integrator was told to set `"direct"` explicitly, so the value decides the answer:
 * `"direct"` asked for the login that is now the only one and costs a warning, while
 * `"hosted"` asked for a mode that is gone and cannot be silently reinterpreted as its
 * replacement — the origins Direct login needs may not be registered at all.
 */
function checkRemovedAuthMode(config: FluentWidgetConfig): void {
  const authMode = (config as { authMode?: unknown }).authMode;
  if (authMode === undefined) return;
  if (authMode === "direct") {
    if (!legacyAuthModeWarned) {
      legacyAuthModeWarned = true;
      console.warn(
        "FluentWidgetConfig.authMode was removed in 0.5.0 and is ignored. Delete the key: " +
          'Direct login — what authMode: "direct" asked for — is now the only login.',
      );
    }
    return;
  }
  throw new FluentWidgetConfigError(
    "removed_option",
    `FluentWidgetConfig.authMode: ${describeRejectedValue(authMode)} is not supported — ` +
      "hosted mode was removed in 0.5.0. Delete the authMode key: every user now signs in " +
      "with Direct login, which needs this App's origin registered on the Privy app client " +
      "behind privyClientId.",
  );
}

export function resolveFluentWidgetConfig(config: FluentWidgetConfig): ResolvedFluentWidgetConfig {
  checkRemovedAuthMode(config);
  if (config.clientId !== undefined) {
    throw new FluentWidgetConfigError(
      "removed_option",
      "FluentWidgetConfig.clientId was removed in 0.2.0. " +
        `${APP_ID_HINT} Pass the Privy app client as privyClientId — both are required.`,
    );
  }
  // Checked before the empty-appId check: an integrator on 0.2.x who has not renamed the
  // field yet must be told about the rename, not that appId is missing.
  if (config.partnerId !== undefined) {
    throw new FluentWidgetConfigError(
      "removed_option",
      `FluentWidgetConfig.partnerId was renamed to appId in 0.3.0. ${APP_ID_HINT}`,
    );
  }
  const appId = readStringOption(config.appId, "appId", APP_ID_HINT);
  if (!appId) {
    throw new FluentWidgetConfigError(
      "missing_option",
      `FluentWidgetConfig.appId is required. ${APP_ID_HINT}`,
    );
  }
  if (appId.startsWith("client-")) {
    throw new FluentWidgetConfigError(
      "invalid_option",
      `FluentWidgetConfig.appId "${appId}" is a Privy app client, not an app id. ` +
        "Pass the app_<32 hex> id as appId and the Privy client as privyClientId.",
    );
  }
  // A wrong id is not refused loudly anywhere else: the service answers "unknown app" and
  // sponsorship silently stops. Startup is the one moment the integrator is looking, so an
  // id of any other shape — an old partner_… value included — dies here.
  if (!APP_ID_PATTERN.test(appId)) {
    throw new FluentWidgetConfigError(
      "invalid_option",
      `FluentWidgetConfig.appId "${appId}" is not an app id. ` +
        "Expected app_<32 hex> (lowercase), the id the Fluent Dashboard shows for the App.",
    );
  }
  const privyClientId = readStringOption(
    config.privyClientId,
    "privyClientId",
    "Pass the Privy app client issued by Fluent for this App.",
  );
  if (!privyClientId) {
    throw new FluentWidgetConfigError(
      "missing_option",
      "FluentWidgetConfig.privyClientId is required. Pass the Privy app client issued by Fluent for this App.",
    );
  }
  if (privyClientId.startsWith("app_")) {
    throw new FluentWidgetConfigError(
      "invalid_option",
      `FluentWidgetConfig.privyClientId "${privyClientId}" is an app id, not a Privy app client. ` +
        "Swap the two: appId takes the app_<32 hex> id, privyClientId the client-… value.",
    );
  }
  // Privy rejects an unknown client with a silent invalid_origin no-op on the login
  // button, so a malformed value has to die here, where it can say why.
  if (!privyClientId.startsWith("client-")) {
    throw new FluentWidgetConfigError(
      "invalid_option",
      `FluentWidgetConfig.privyClientId "${privyClientId}" does not look like a Privy app client — ` +
        "expected the client-… value issued by Fluent.",
    );
  }

  // A JavaScript host can omit the field or pass any value; the type promises neither.
  const network: unknown = config.network;
  if (network === undefined || network === null) {
    throw new FluentWidgetConfigError(
      "missing_option",
      `FluentWidgetConfig.network is required. ${NETWORK_HINT}`,
    );
  }
  if (network !== "testnet" && network !== "mainnet") {
    throw new FluentWidgetConfigError(
      "invalid_option",
      `FluentWidgetConfig.network ${describeRejectedValue(network)} is not supported. ` +
        NETWORK_HINT,
    );
  }
  const endpoints = getFluentWidgetNetworkEndpoints(network);

  return {
    network,
    appName: config.appName ?? "Fluent Connect Demo",
    appId,
    privyClientId,
    customOAuthRedirectUrl: resolveCustomOAuthRedirectUrl(config.customOAuthRedirectUrl),
    authMethods: resolveFluentWidgetAuthMethods(config.enabledAuthMethods),
    faucetEndpoint: endpoints.faucetEndpoint,
    eventsEndpoint: "",
    analyticsHost: endpoints.analyticsHost,
    sponsorshipUrl: config.sponsorshipUrl ?? endpoints.sponsorshipUrl,
    authTokenRenewalOffsetSeconds: config.authTokenRenewalOffsetSeconds ?? 30,
    disableAnalytics: config.disableAnalytics ?? false,
    reconnectOnMount: config.reconnectOnMount,
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
      defaultToken: resolveGasPaymentDefaultToken(network, config.gasPayment?.defaultToken),
      sponsorship: config.gasPayment?.sponsorship ?? "auto",
      ethValueByToken: config.gasPayment?.ethValueByToken,
    },
    execution: resolveFluentWidgetExecution(config.execution),
    quickSign: {
      whitelistAddresses: resolveQuickSignWhitelist(config.quickSign?.whitelistAddresses),
    },
    reputationEnabled: config.reputationEnabled ?? true,
    // `scopes` left the config in 0.6.0; a JavaScript host that still passes it is ignored.
    scopes: getFluentWidgetDefaultScopes(network),
    source: config.source ?? "fluent_connect_widget",
    campaign: config.campaign,
    assets: {
      ...FLUENT_CONNECT_DEFAULT_ASSETS,
      ...config.assets,
    },
    avatar: {
      defaultLogoUrl:
        readStringOption(
          config.avatar?.defaultLogoUrl,
          "avatar.defaultLogoUrl",
          "Pass the URL of an image, or leave it unset.",
        ) || undefined,
      forceDefault: config.avatar?.forceDefault ?? false,
    },
  };
}

export function createFluentConnectForWidget(config: FluentWidgetConfig) {
  const resolved = resolveFluentWidgetConfig(config);
  // connect-sdk keeps its own `clientId` option and keeps receiving the Privy app
  // client it always did; the app id never travels there.
  return fluent.initialize({
    network: resolved.network,
    appName: resolved.appName,
    clientId: resolved.privyClientId,
    scopes: resolved.scopes,
    source: resolved.source,
    campaign: resolved.campaign,
  });
}
