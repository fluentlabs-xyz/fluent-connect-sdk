import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import {
  FLUENT_CONNECT_PRIVY_APP_ID,
  FLUENT_CONNECT_PRIVY_CONFIG,
  createFluentConnectForWidget,
  FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY,
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "./config";
import { type FluentExternalWalletState } from "./types";
import { ConnectChoiceModal } from "./components/ConnectChoiceModal";
import { Icon } from "./components/Icon";
import { WalletMenuActionCard } from "./components/WalletMenuActionCard";
import { Button } from "./components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
} from "./components/ui/drawer";
import { useIsMobile } from "./hooks/use-mobile";
import { formatAddress } from "./utils/formatAddress";
import { formatExternalWallet } from "./utils/formatExternalWallet";
import { formatSession } from "./utils/formatSession";
import { getAnonymousId } from "./utils/getAnonymousId";
import { postJson } from "./utils/postJson";
import type { FluentTokenDefinition } from "@fluent/wallet-sdk";
import { ReownProvider, useReownWallet } from "./reownAppKit";
import { createFluentBatchOp, type FluentBatchApi, type FluentWidgetAccount } from "./batchOperation";
import { createFluentPermissionApi } from "./permissionSession";
import { useFluentZeroDevAccount } from "./zerodevSession";
import type { Address } from "viem";

export type FluentWidgetRenderContext = {
  session: FluentWidgetSession | null;
  connectedAddress?: string;
  wallet: FluentExternalWalletState | null;
  widget: FluentBatchApi;
  openConnect: () => void;
};

export type FluentWidgetProps = {
  wallet?: FluentExternalWalletState | null;
  config?: FluentWidgetConfig;
  mode?: "home" | "page";
  renderHome?: (context: FluentWidgetRenderContext) => ReactNode;
  renderPage?: (context: FluentWidgetRenderContext) => ReactNode;
  renderPermissions?: (context: { session: FluentWidgetSession | null; compact: boolean }) => ReactNode;
  tokens?: readonly FluentTokenDefinition[];
  showDebugPayload?: boolean;
  onSessionChange?: (session: FluentWidgetSession | null) => void;
};

export function FluentWidget(props: FluentWidgetProps) {
  return (
    <PrivyProvider appId={FLUENT_CONNECT_PRIVY_APP_ID} config={FLUENT_CONNECT_PRIVY_CONFIG}>
      <ReownProvider>
        <FluentWidgetContent {...props} />
      </ReownProvider>
    </PrivyProvider>
  );
}

function FluentWidgetContent({
  wallet,
  config,
  mode = "home",
  renderHome,
  renderPage,
  renderPermissions,
  tokens,
  showDebugPayload = true,
  onSessionChange,
}: FluentWidgetProps) {
  const internalWallet = useReownWallet();
  const isMobile = useIsMobile();
  const smartAccount = useFluentZeroDevAccount();
  const activeWallet = wallet ?? internalWallet;
  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(config), [config]);
  const fluentConnect = useMemo(() => createFluentConnectForWidget(config), [config]);
  const [session, setSessionState] = useState<FluentWidgetSession | null>(() => {
    try {
      const raw = window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as FluentWidgetSession) : null;
    } catch {
      return null;
    }
  });
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [privyIdentityToken, setPrivyIdentityToken] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [hostedAuthorizeUrl, setHostedAuthorizeUrl] = useState<string | undefined>();
  const hostedConnectWindow = useRef<Window | null>(null);
  const zeroDevInitRequested = useRef(false);
  const fluentAccountAddress = smartAccount.smartAccountAddress ?? session?.wallet.smartAccountAddress;
  const connectedAddress = activeWallet?.connected && activeWallet.address ? activeWallet.address : fluentAccountAddress;
  const hasConnectedAccount = Boolean(activeWallet?.connected || session?.user?.id || session?.wallet?.smartAccountAddress);
  const widgetAccount = useMemo<FluentWidgetAccount>(() => {
    const address = (smartAccount.smartAccountAddress ?? fluentAccountAddress ?? connectedAddress) as Address | undefined;
    const executionReady = Boolean(smartAccount.smartAccountReady && smartAccount.smartAccountAddress);
    const connected = Boolean(hasConnectedAccount || address);

    return {
      address,
      signerAddress: smartAccount.signerAddress,
      connected,
      executionReady,
      executionStatus: executionReady
        ? "ready"
        : !connected
          ? "disconnected"
          : smartAccount.error
            ? "error"
            : "unavailable",
      executionError: smartAccount.error?.message,
    };
  }, [
    connectedAddress,
    fluentAccountAddress,
    hasConnectedAccount,
    smartAccount.error,
    smartAccount.signerAddress,
    smartAccount.smartAccountAddress,
    smartAccount.smartAccountReady,
  ]);

  const setSession = useCallback(
    (nextSession: FluentWidgetSession | null) => {
      console.log("[fluent widget] setSession", {
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id,
        signerAddress: nextSession?.wallet?.signerAddress,
        smartAccountAddress: nextSession?.wallet?.smartAccountAddress,
        scopes: nextSession?.scopes,
      });
      setSessionState(nextSession);
      onSessionChange?.(nextSession);
    },
    [onSessionChange],
  );

  const openConnectFlow = useCallback(() => {
    setAccountOpen(false);
    setHostedError(null);
    const state = crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const authorizeUrl = fluentConnect.buildAuthorizeUrl(state).toString();
    console.log("[fluent widget] open connect", {
      state,
      authorizeUrl,
      clientId: resolvedConfig.clientId,
      appName: resolvedConfig.appName,
    });
    setHostedAuthorizeUrl(authorizeUrl);
    setConnectOpen(true);
  }, [fluentConnect, resolvedConfig.appName, resolvedConfig.clientId]);
  const handleTopConnectClick = useCallback(() => {
    if (hasConnectedAccount) {
      setAccountOpen((current) => !current);
      return;
    }

    openConnectFlow();
  }, [hasConnectedAccount, openConnectFlow]);
  const handleDisconnect = useCallback(async () => {
    setAccountOpen(false);
    setSession(null);
    setPrivyIdentityToken(null);
    zeroDevInitRequested.current = false;
    fluentConnect.disconnect();
    window.localStorage.removeItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
    window.localStorage.removeItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
    setWalletStatus("Disconnected");
    if (activeWallet?.connected) activeWallet.disconnect();
  }, [activeWallet, fluentConnect, setSession]);

  const handleFaucetClaim = useCallback(async () => {
    if (!session) {
      setWalletStatus("Connect with Fluent ID before claiming faucet");
      return;
    }

    if (!privyIdentityToken) {
      setWalletStatus("Privy identity token missing. Reconnect with Fluent ID.");
      return;
    }

    setFaucetBusy(true);
    setWalletStatus("Requesting BLEND faucet");
    try {
      const receipt = await postJson<{ status?: string; txHash?: string; message?: string }>(
        resolvedConfig.faucetEndpoint,
        {
          visitorId: getAnonymousId(),
          fluentSessionToken: session.idToken,
        },
        {
          Authorization: `Bearer ${privyIdentityToken}`,
        },
      );
      setWalletStatus(receipt.message ?? receipt.txHash ?? receipt.status ?? "Faucet request completed");
    } catch (err) {
      setWalletStatus(err instanceof Error ? err.message : "Faucet request failed");
    } finally {
      setFaucetBusy(false);
    }
  }, [privyIdentityToken, resolvedConfig.faucetEndpoint, session]);

  const acceptHostedResult = useCallback(
    (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const payload = data as {
        type?: string;
        error?: string;
        session?: FluentWidgetSession;
        privyIdentityToken?: string | null;
      };
      if (payload.type === "fluent:connect:error") {
        setHostedError(typeof payload.error === "string" ? payload.error : "Fluent Connect login failed");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }
      if (payload.type !== "fluent:connect:session" || !payload.session) return;

      const nextIdentityToken =
        typeof payload.privyIdentityToken === "string" ? payload.privyIdentityToken : null;
      console.log("[fluent widget] hosted result accepted", {
        userId: payload.session.user?.id,
        signerAddress: payload.session.wallet?.signerAddress,
        smartAccountAddress: payload.session.wallet?.smartAccountAddress,
        scopes: payload.session.scopes,
        hasIdentityToken: Boolean(nextIdentityToken),
      });
      setSession(payload.session);
      zeroDevInitRequested.current = false;
      fluentConnect.setSession(payload.session);
      setPrivyIdentityToken(nextIdentityToken);
      window.localStorage.setItem(FLUENT_WIDGET_SESSION_STORAGE_KEY, JSON.stringify(payload.session));
      if (nextIdentityToken) {
        window.localStorage.setItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY, nextIdentityToken);
      } else {
        window.localStorage.removeItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
      }
      setWalletStatus("Wallet connected!");
      setHostedError(null);
      setConnectOpen(false);
      hostedConnectWindow.current?.close();
      hostedConnectWindow.current = null;
      window.setTimeout(() => {
        void smartAccount.refresh().catch((error) => {
          console.warn("[fluent widget] ZeroDev account not ready after hosted login", error);
        });
      }, 250);
    },
    [fluentConnect, setSession, smartAccount.refresh],
  );

  useEffect(() => {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const rawResult = hash.get("fluent_connect_result");
    if (!rawResult) return;

    try {
      acceptHostedResult(JSON.parse(rawResult));
    } catch {
      setHostedError("Could not parse Fluent Connect result");
    } finally {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }, [acceptHostedResult]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== new URL(resolvedConfig.authorizeUrl, location.href).origin) return;
      if (!event.data) return;
      acceptHostedResult(event.data);
    }

    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [acceptHostedResult, resolvedConfig.authorizeUrl]);

  useEffect(() => {
    return () => {
      hostedConnectWindow.current?.close();
      hostedConnectWindow.current = null;
    };
  }, []);

  useEffect(() => {
    console.log("[fluent widget] account state", {
      hasSession: Boolean(session),
      sessionUserId: session?.user?.id,
      sessionSignerAddress: session?.wallet?.signerAddress,
      sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
      widgetAddress: widgetAccount.address,
      widgetConnected: widgetAccount.connected,
      executionReady: widgetAccount.executionReady,
      executionStatus: widgetAccount.executionStatus,
      executionError: widgetAccount.executionError,
      privyReady: smartAccount.privyReady,
      privyAuthenticated: smartAccount.privyAuthenticated,
      embeddedWalletCount: smartAccount.embeddedWalletCount,
      signerAddress: smartAccount.signerAddress,
      zeroDevSmartAccountAddress: smartAccount.smartAccountAddress,
      zeroDevInitRequested: zeroDevInitRequested.current,
    });
  }, [
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.privyAuthenticated,
    smartAccount.privyReady,
    smartAccount.signerAddress,
    smartAccount.smartAccountAddress,
    widgetAccount.address,
    widgetAccount.connected,
    widgetAccount.executionError,
    widgetAccount.executionReady,
    widgetAccount.executionStatus,
  ]);

  useEffect(() => {
    if (!session || smartAccount.smartAccountReady) return;
    if (!smartAccount.privyAuthenticated || smartAccount.embeddedWalletCount === 0) {
      console.warn("[fluent widget] ZeroDev init skipped: signer unavailable", {
        privyReady: smartAccount.privyReady,
        privyAuthenticated: smartAccount.privyAuthenticated,
        embeddedWalletCount: smartAccount.embeddedWalletCount,
      });
      return;
    }
    if (zeroDevInitRequested.current) {
      console.log("[fluent widget] ZeroDev init skipped: request already in flight");
      return;
    }

    zeroDevInitRequested.current = true;
    console.log("[fluent widget] requesting ZeroDev refresh");
    void smartAccount.refresh().catch((error) => {
      zeroDevInitRequested.current = false;
      console.warn("[fluent widget] ZeroDev account initialization failed", error);
    });
  }, [
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.privyAuthenticated,
    smartAccount.refresh,
    smartAccount.smartAccountReady,
  ]);

  const context: FluentWidgetRenderContext = {
    session,
    connectedAddress,
    wallet: activeWallet,
    widget: {
      account: widgetAccount,
      /// Batch operations are initialised from the widget object exposed to a
      /// host app. Builders provide ABI/method calls, the SDK encodes them,
      /// and `smartAccount.sendCalls` submits the bundled UserOp through the
      /// user's Fluent ZeroDev account.
      createBatchOp: (input) =>
        createFluentBatchOp(input, {
          account: widgetAccount,
          smartAccountReady: smartAccount.smartAccountReady,
          sendCalls: smartAccount.sendCalls,
        }),
      /// ZeroDev permission sessions are initialised from the same widget
      /// object. `createFluentPermissionApi` binds the active Kernel account so
      /// apps can later request scoped session policies instead of raw private
      /// key delegation.
      ...createFluentPermissionApi({
        kernel: smartAccount.kernel,
        smartAccountReady: smartAccount.smartAccountReady,
      }),
    },
    openConnect: openConnectFlow,
  };

  const widget = (
    <div className="dark contents antialiased">
      <Drawer
        open={hasConnectedAccount && accountOpen}
        onOpenChange={setAccountOpen}
        swipeDirection={isMobile ? "down" : "right"}
      >
        <div className="fixed top-5 right-5 z-50">
          <button
            type="button"
            className="bg-black p-1.5 pr-3 rounded-xl flex items-center gap-2 shadow-2xl overflow-hidden relative group"
            aria-expanded={hasConnectedAccount ? accountOpen : undefined}
            onClick={handleTopConnectClick}
          >
            <div className="size-9 p-3 bg-white/5 rounded-md flex items-center justify-center relative z-10 ">
              <Icon name="fluent" className="w-full " />
            </div>

            <div
              className="absolute z-[1] inset-0 h-[200%] opacity-25 group-hover:opacity-50 transition-all duration-250 ease-in-out -translate-y-0 group-hover:-translate-y-5 group-hover:h-[300%]"
              style={{
                background:
                    "radial-gradient(152.48% 152.48% at 50% 84.8%, #000 25.21%, #5011FF 53.1%)",
                backgroundSize: "150% auto",
                backgroundPosition: "center center",
                backgroundRepeat: "no-repeat",
              }}
            />

            {hasConnectedAccount ? (
              <div className="flex flex-col items-start gap-0.5 relative z-10">
                <div className="text-[10px] leading-none text-white/50">Wallet</div>
                <div className="text-sm font-medium leading-none">
                  {activeWallet?.connected
                    ? connectedAddress
                      ? formatAddress(connectedAddress)
                      : "Connected"
                    : fluentAccountAddress
                      ? formatAddress(fluentAccountAddress)
                      : "Connected"}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-0.5 relative z-10">
                <div className="text-sm font-medium leading-none">Connect Wallet</div>
                <div className="text-[10px] leading-none text-white/50">Powered by Fluent</div>
              </div>
            )}
          </button>
        </div>

        {hasConnectedAccount ? (
          <DrawerContent
            aria-label="Connected account"
            className="dark antialiased sm:w-96"
          >

            <DrawerHeader className="items-stretch p-4 pb-0">
              <div className="border border-white/10 p-2 pr-3 rounded-xl flex items-center gap-2 shadow-2xl overflow-hidden relative">
                <div className="size-9 p-3 bg-white/10 rounded-md flex items-center justify-center relative z-10">
                  <Icon name="fluent" className="w-full" />
                </div>
                <div className="flex flex-col items-start gap-0.5 relative z-10">
                <div className="text-[10px] leading-none text-white/50">
                    {activeWallet?.connected ? "Reown AppKit" : "Fluent Connect ID"}
                  </div>
                  <div className="text-sm font-medium leading-none">
                    {activeWallet?.connected
                      ? connectedAddress
                        ? formatAddress(connectedAddress)
                        : "Connected"
                      : fluentAccountAddress
                        ? formatAddress(fluentAccountAddress)
                        : "Connected"}
                  </div>
                </div>
              </div>
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <WalletMenuActionCard
                session={session}
                smartAccountAddress={fluentAccountAddress}
                faucetBusy={faucetBusy}
                onFaucet={handleFaucetClaim}
                config={config}
                renderPermissions={renderPermissions}
                tokens={tokens}
              />
            </div>
            <DrawerFooter>
              <Button variant="secondary" onClick={handleDisconnect}>
                Disconnect
              </Button>
            </DrawerFooter>
          </DrawerContent>
        ) : null}
      </Drawer>

      {mode === "page" ? renderPage?.(context) : renderHome?.(context)}

      {showDebugPayload && mode === "home" ? (
        <section className="payload">
          <div className="payload-header">
            <h2>Host app callback</h2>
            <span>mock</span>
          </div>
          <pre>{formatSession(session)}</pre>
          <div className="payload-header payload-header-secondary">
            <h2>External wallet</h2>
            <span>{activeWallet?.connected ? "Reown" : "wallet"}</span>
          </div>
          <pre>{formatExternalWallet(activeWallet, walletStatus)}</pre>
          {hostedError ? <p className="payload-error">{hostedError}</p> : null}
        </section>
      ) : null}

      <ConnectChoiceModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        wallet={activeWallet}
        fluentReady
        config={config}
        fluentAuthorizeUrl={hostedAuthorizeUrl}
        hostedError={hostedError}
        onFluentLogin={() => {
          setWalletStatus("Opening hosted Fluent Connect ID");
        }}
      />
    </div>
  );

  return widget;
}
