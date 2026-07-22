export type FluentNetwork = "devnet" | "testnet" | "mainnet";

export type FluentInitializeConfig = {
  network: FluentNetwork;
  /**
   * Advanced override for registered production apps.
   * Default integrations should omit this and let Fluent derive app identity from origin.
   */
  clientId?: string;
  /**
   * Optional display hint for anonymous/basic mode.
   * Fluent-controlled hosted auth remains the source of truth for registered app metadata.
   */
  appName?: string;
  authorizeUrl?: string;
  scopes?: string[];
  source?: string;
  campaign?: string;
  storage?: StorageLike;
  origin?: string;
  redirectUri?: string;
};

export type FluentAppIdentity = {
  mode: "origin" | "registered";
  origin: string;
  installationId: string;
  clientId?: string;
  appName?: string;
};

export type FluentSession = {
  app: FluentAppIdentity;
  user: {
    id: string;
    email?: string;
  };
  wallet: {
    smartAccountAddress?: `0x${string}`;
  };
  scopes: string[];
  issuedAt: number;
  idToken?: string;
};

export type FluentConnectionStatus = {
  status: "connected" | "disconnected";
  network: FluentNetwork;
  app: FluentAppIdentity;
  session?: FluentSession;
};

export type FluentConnectOptions = {
  popup?: WindowOpenLike;
  state?: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type WindowOpenLike = (url?: string | URL, target?: string, features?: string) => unknown;

type BrowserWindowLike = {
  location?: {
    origin?: string;
    pathname?: string;
  };
  localStorage?: StorageLike;
  open?: WindowOpenLike;
};

const DEFAULT_AUTHORIZE_URL = "https://connect.fluent.xyz/authorize";
const DEFAULT_SCOPES = ["openid", "profile", "wallet", "faucet"];
const INSTALLATION_ID_KEY = "fluent:connect:installation-id:v1";
const SESSION_KEY = "fluent:connect:session:v1";

function getBrowserOrigin(): string {
  const browserWindow = (globalThis as { window?: BrowserWindowLike }).window;
  if (!browserWindow?.location?.origin) {
    throw new Error("origin is required outside a browser");
  }
  return browserWindow.location.origin;
}

function getBrowserRedirectUri(): string {
  const browserWindow = (globalThis as { window?: BrowserWindowLike }).window;
  if (!browserWindow?.location?.origin) {
    throw new Error("redirectUri is required outside a browser");
  }
  return `${browserWindow.location.origin}${browserWindow.location.pathname ?? "/"}`;
}

function getBrowserStorage(): StorageLike | undefined {
  return (globalThis as { window?: BrowserWindowLike }).window?.localStorage;
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.some(Boolean)) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `fluent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function getOrCreateInstallationId(storage: StorageLike | undefined): string {
  const stored = storage?.getItem(INSTALLATION_ID_KEY);
  if (stored) return stored;

  const next = randomId();
  storage?.setItem(INSTALLATION_ID_KEY, next);
  return next;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export class FluentConnectSDK {
  private config: Required<Pick<FluentInitializeConfig, "network" | "authorizeUrl" | "scopes" | "source">> &
    Omit<FluentInitializeConfig, "network" | "authorizeUrl" | "scopes" | "source">;
  private app: FluentAppIdentity;
  private session: FluentSession | undefined;

  constructor(config: FluentInitializeConfig) {
    const storage = config.storage ?? getBrowserStorage();
    const origin = config.origin ?? getBrowserOrigin();
    const installationId = getOrCreateInstallationId(storage);

    this.config = {
      ...config,
      authorizeUrl: config.authorizeUrl ?? DEFAULT_AUTHORIZE_URL,
      scopes: config.scopes ?? DEFAULT_SCOPES,
      source: config.source ?? "fluent_connect_sdk",
      storage,
      origin,
      redirectUri: config.redirectUri ?? getBrowserRedirectUri(),
    };
    this.app = {
      mode: config.clientId ? "registered" : "origin",
      origin,
      installationId,
      clientId: config.clientId,
      appName: config.appName,
    };
    this.session = this.readStoredSession();
  }

  status(): FluentConnectionStatus {
    return {
      status: this.session ? "connected" : "disconnected",
      network: this.config.network,
      app: this.app,
      session: this.session,
    };
  }

  buildAuthorizeUrl(state = randomId()): URL {
    const url = new URL(withoutTrailingSlash(this.config.authorizeUrl));
    url.searchParams.set("origin", this.app.origin);
    url.searchParams.set("installation_id", this.app.installationId);
    url.searchParams.set("redirect_uri", this.config.redirectUri ?? this.app.origin);
    url.searchParams.set("scope", this.config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("network", this.config.network);
    url.searchParams.set("source", this.config.source);

    if (this.app.clientId) url.searchParams.set("client_id", this.app.clientId);
    if (this.app.appName) url.searchParams.set("app_name", this.app.appName);
    if (this.config.campaign) url.searchParams.set("campaign", this.config.campaign);

    return url;
  }

  connect(options: FluentConnectOptions = {}): URL {
    const url = this.buildAuthorizeUrl(options.state);
    const browserWindow = (globalThis as { window?: BrowserWindowLike }).window;
    const opener = options.popup ?? (browserWindow?.open ? browserWindow.open.bind(browserWindow) : undefined);
    opener?.(url, "fluent-connect", "popup,width=460,height=680");
    return url;
  }

  setSession(session: Omit<FluentSession, "app"> & { app?: FluentAppIdentity }): FluentSession {
    const nextSession = {
      ...session,
      app: session.app ?? this.app,
    };
    this.session = nextSession;
    this.config.storage?.setItem(SESSION_KEY, JSON.stringify(nextSession));
    return nextSession;
  }

  disconnect(): FluentConnectionStatus {
    this.session = undefined;
    this.config.storage?.removeItem(SESSION_KEY);
    return this.status();
  }

  private readStoredSession(): FluentSession | undefined {
    try {
      const raw = this.config.storage?.getItem(SESSION_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as FluentSession;
      if (parsed.app?.origin !== this.app.origin) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }
}

export function initialize(config: FluentInitializeConfig): FluentConnectSDK {
  return new FluentConnectSDK(config);
}

export const fluent = {
  initialize,
};

export { fluentBridgeAbi } from "./abis/fluent-bridge.js";
export {
  getContractAddressFromChain,
  resolveBridgeAddresses,
  resolveL1Definition,
  type BridgeAddresses,
} from "./addresses.js";
export {
  createFluentClient,
  type FluentClient,
  type FluentClientConfig,
} from "./client.js";
export {
  createFluentPermissionClient,
  type FluentCallPermission,
  type FluentPermissionClient,
  type FluentPermissionClientConfig,
  type FluentPermissionGrant,
  type FluentPermissionGrantRequest,
  type FluentPermissionPolicy,
  type FluentPermissionPreview,
  type FluentPermissionStatus,
  type FluentSpendPeriod,
  type FluentSpendPermission,
} from "./permissions.js";
export {
  fluentTestnetTokenDefaults,
  fluentTestnetWidgetTokens,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "./balances.js";
export {
  createFluentFamiliesClient,
  type FluentFamilies,
  type FluentFamiliesClient,
  type FluentFamiliesClientConfig,
  type FluentFamily,
  type FluentFamilyTier,
  type FluentFamilyType,
} from "./families.js";
export {
  fluentDevnet,
  fluentMainnet,
  fluentTestnet,
  sepolia,
  fluent as fluentChain,
  fluentDefinitionToViemChain,
  l1DefinitionToViemChain,
} from "./chains.js";

export {
  apps,
  fluentChains,
  fluentZeroDevChainIds,
  getApp,
  getFluentChain,
  getFluentChainByChainId,
  getL1Chain,
  getL1ForFluentChain,
  getZerodevIntegration,
  getZeroDevRpcUrl,
  integrations,
  isFluentZeroDevChain,
  l1Chains,
  registryVersion,
  type AppDefinition,
  type FluentChainDefinition,
  type L1ChainDefinition,
  type ZerodevIntegration,
} from "@fluent/registry";
