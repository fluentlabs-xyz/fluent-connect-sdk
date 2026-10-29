export type FluentNetwork = "testnet" | "mainnet";

export type FluentInitializeConfig = {
  network: FluentNetwork;
  /**
   * Advanced override for registered production apps.
   * Default integrations should omit this and let Fluent derive app identity from origin.
   */
  clientId?: string;
  /**
   * Optional display hint for anonymous/basic mode.
   * The Fluent Dashboard remains the source of truth for registered app metadata.
   */
  appName?: string;
  scopes?: string[];
  source?: string;
  campaign?: string;
  storage?: StorageLike;
  origin?: string;
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

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type BrowserWindowLike = {
  location?: {
    origin?: string;
  };
  localStorage?: StorageLike;
};

const DEFAULT_SCOPES = ["openid", "profile", "wallet", "faucet"];
const INSTALLATION_ID_KEY = "fluent:connect:installation-id:v1";
/**
 * The key under which earlier versions kept a copy of the session, the Privy DID and `idToken`
 * included. Nothing reads it since FLU-1638: the widget's stored session is the one stored copy,
 * and the constructor removes a value an earlier version left.
 */
const LEGACY_SESSION_KEY = "fluent:connect:session:v1";

function getBrowserOrigin(): string {
  const browserWindow = (globalThis as { window?: BrowserWindowLike }).window;
  if (!browserWindow?.location?.origin) {
    throw new Error("origin is required outside a browser");
  }
  return browserWindow.location.origin;
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

function removeLegacySession(storage: StorageLike | undefined): void {
  try {
    storage?.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Best effort: a storage that refuses the removal must not stop the SDK from starting, and
    // nothing reads the value it keeps.
  }
}

function getOrCreateInstallationId(storage: StorageLike | undefined): string {
  const stored = storage?.getItem(INSTALLATION_ID_KEY);
  if (stored) return stored;

  const next = randomId();
  storage?.setItem(INSTALLATION_ID_KEY, next);
  return next;
}

export class FluentConnectSDK {
  private config: Required<Pick<FluentInitializeConfig, "network" | "scopes" | "source">> &
    Omit<FluentInitializeConfig, "network" | "scopes" | "source">;
  private app: FluentAppIdentity;
  private session: FluentSession | undefined;

  constructor(config: FluentInitializeConfig) {
    const storage = config.storage ?? getBrowserStorage();
    const origin = config.origin ?? getBrowserOrigin();
    const installationId = getOrCreateInstallationId(storage);
    removeLegacySession(storage);

    this.config = {
      ...config,
      scopes: config.scopes ?? DEFAULT_SCOPES,
      source: config.source ?? "fluent_connect_sdk",
      storage,
      origin,
    };
    this.app = {
      mode: config.clientId ? "registered" : "origin",
      origin,
      installationId,
      clientId: config.clientId,
      appName: config.appName,
    };
  }

  status(): FluentConnectionStatus {
    return {
      status: this.session ? "connected" : "disconnected",
      network: this.config.network,
      app: this.app,
      session: this.session,
    };
  }

  /** Holds the session in memory only; a new instance starts disconnected. */
  setSession(session: Omit<FluentSession, "app"> & { app?: FluentAppIdentity }): FluentSession {
    const nextSession = {
      ...session,
      app: session.app ?? this.app,
    };
    this.session = nextSession;
    return nextSession;
  }

  disconnect(): FluentConnectionStatus {
    this.session = undefined;
    return this.status();
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
  fluentMainnetTokenDefaults,
  fluentTokenIdentity,
  getFluentTokenDefaultsForNetwork,
  getFluentDefaultWidgetDisplayTokens,
  getFluentDefaultWidgetGasTokens,
  isFluentNativeToken,
  isFluentDefaultToken,
  sortFluentGasTokens,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "./balances.js";
export {
  FLUENT_MAX_TOKEN_DECIMALS,
  isFluentTokenDecimals,
  readFluentTokenMetadata,
  type FluentTokenMetadataResult,
} from "./tokenMetadata.js";
export {
  findFluentSymbolCollisions,
  mergeFluentDisplayTokens,
  type FluentDisplayToken,
  type FluentTokenSource,
} from "./tokenSources.js";
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
} from "@fluent.xyz/registry";
