import {
  FluentConnectProvider,
  fluentTestnet,
  type FluentWidgetSession,
} from "@fluent/react";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, formatUnits, http, parseUnits, type Hash } from "viem";
import {
  ReownProvider,
  reownConfigured,
  useReownWallet,
  type ReownWalletState,
} from "./reown-appkit";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;
const FLUENT_CLIENT_ID = import.meta.env.VITE_FLUENT_CLIENT_ID ?? "demo_app";
const FLUENT_SESSION_ENDPOINT = import.meta.env.VITE_FLUENT_SESSION_ENDPOINT ?? "";
const FLUENT_FAUCET_ENDPOINT =
  import.meta.env.VITE_FLUENT_FAUCET_ENDPOINT ??
  "https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund";
const FLUENT_EVENTS_ENDPOINT = import.meta.env.VITE_FLUENT_EVENTS_ENDPOINT ?? "";
const FLUENT_LOGO = "/fluent-assets/fluent-logo.svg";
const WALLETCONNECT_ICON = "/fluent-assets/walletconnect.svg";
const METAMASK_ICON = "/fluent-assets/metamask.svg";
const COINBASE_ICON = "/fluent-assets/coinbase.svg";
const FLUENT_PORTAL_BRIDGE_URL = "https://portal.fluent.xyz/bridge";
const HOSTED_AUTHORIZE_URL =
  import.meta.env.VITE_FLUENT_AUTHORIZE_URL ?? `${window.location.origin}/authorize`;
const FLUENT_HOSTED_SESSION_ENDPOINT =
  import.meta.env.VITE_FLUENT_HOSTED_SESSION_ENDPOINT ?? "";
const BLEND_TOKEN_ADDRESS = "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const;
const BLEND_PAYMENT_AMOUNT = "1";
const BLEND_PAYMENT_RECIPIENT = (import.meta.env.VITE_BLEND_PAY_RECIPIENT ||
  "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4") as `0x${string}`;
const blendPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(),
});
const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function formatSession(session: FluentWidgetSession | null): string {
  if (!session) return "Waiting for Fluent login";

  return JSON.stringify(
    {
      clientId: session.clientId,
      user: session.user,
      wallet: session.wallet,
      scopes: session.scopes,
      issuedAt: session.issuedAt,
      idToken: session.idToken,
    },
    null,
    2,
  );
}

function formatExternalWallet(wallet: ReownWalletState | null, status: string | null): string {
  return JSON.stringify(
    {
      status: status ?? "Waiting for wallet connection",
      wallet: wallet
        ? {
            provider: "Reown AppKit",
            connected: wallet.connected,
            address: wallet.address,
            chainId: wallet.chainId,
          }
        : null,
      walletConnectEnabled: reownConfigured,
    },
    null,
    2,
  );
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function explorerTx(hash: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/tx/${hash}`;
}

function explorerAddress(address: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/address/${address}`;
}

function getAnonymousId(): string {
  const storageKey = "fluent_demo_visitor_id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const next = crypto.randomUUID?.() ?? `visitor_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(storageKey, next);
  return next;
}

function getPrivyWalletAddress(user: unknown): string | undefined {
  if (!user || typeof user !== "object") return undefined;
  const wallet = (user as { wallet?: { address?: string } }).wallet;
  return wallet?.address;
}

async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function createMockHostedSession(params: {
  clientId: string;
  scopes: string[];
  userId: string;
  signerAddress?: `0x${string}`;
}): FluentWidgetSession {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: window.location.origin,
    aud: params.clientId,
    sub: params.userId,
    scopes: params.scopes,
    iat: issuedAt,
  };

  return {
    clientId: params.clientId,
    idToken: `mock.${btoa(JSON.stringify(payload))}.signature`,
    user: { id: params.userId },
    wallet: {
      signerAddress: params.signerAddress,
    },
    scopes: params.scopes,
    issuedAt,
    metadata: {
      hosted: "true",
      origin: window.location.origin,
    },
  };
}

function SetupNotice() {
  return (
    <section className="notice">
      <h2>Configure real auth</h2>
      <p>
        Add <code>VITE_PRIVY_APP_ID</code> to <code>examples/privy-connect/.env</code>.
        Optional backend hooks are <code>VITE_FLUENT_SESSION_ENDPOINT</code>,{" "}
        <code>VITE_FLUENT_FAUCET_ENDPOINT</code>, and <code>VITE_FLUENT_EVENTS_ENDPOINT</code>.
      </p>
    </section>
  );
}

function BlendPayGate({
  session,
  wallet,
  onConnect,
}: {
  session: FluentWidgetSession | null;
  wallet: ReownWalletState | null;
  onConnect: () => void;
}) {
  const accountAddress = (wallet?.address ?? session?.wallet.signerAddress) as `0x${string}` | undefined;
  const [tokenSymbol, setTokenSymbol] = useState("BLEND");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [status, setStatus] = useState("Connect to check BLEND access");
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [busy, setBusy] = useState(false);
  const requiredAmount = useMemo(
    () => parseUnits(BLEND_PAYMENT_AMOUNT, tokenDecimals),
    [tokenDecimals],
  );
  const hasEnoughBlend = balance !== null && balance >= requiredAmount;
  const canSendPayment = Boolean(wallet?.connected && wallet.address && wallet.walletClient);

  const refreshBalance = useCallback(async () => {
    if (!accountAddress) {
      setBalance(null);
      setStatus("Connect to check BLEND access");
      return;
    }

    setStatus("Checking BLEND balance");
    try {
      const [nextDecimals, nextSymbol, nextBalance] = await Promise.all([
        blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [accountAddress],
        }),
      ]);
      setTokenDecimals(nextDecimals);
      setTokenSymbol(nextSymbol);
      setBalance(nextBalance);
      setStatus(nextBalance >= parseUnits(BLEND_PAYMENT_AMOUNT, nextDecimals) ? "Ready to pay" : "BLEND required");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not read BLEND balance");
    }
  }, [accountAddress]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const payWithWallet = useCallback(async () => {
    if (!wallet?.walletClient || !wallet.address) return;
    setBusy(true);
    setTxHash(null);
    setStatus("Preparing BLEND payment");
    try {
      if (wallet.chainId !== fluentTestnet.id) {
        setStatus("Switching to Fluent Testnet");
        await wallet.switchChain(fluentTestnet.id);
      }

      setStatus("Waiting for wallet signature");
      const hash = await wallet.walletClient.writeContract({
        account: wallet.address as `0x${string}`,
        chain: fluentTestnet,
        address: BLEND_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [BLEND_PAYMENT_RECIPIENT, requiredAmount],
      });
      setTxHash(hash);
      setStatus("Payment submitted");
      await blendPublicClient.waitForTransactionReceipt({ hash });
      setStatus("Payment confirmed. Premium BLEND section unlocked.");
      await refreshBalance();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }, [refreshBalance, requiredAmount, wallet]);

  return (
    <section className="blend-app">
      <div className="blend-app-main">
        <p className="eyebrow">BLEND pay-in demo</p>
        <h2>Fluent Yield Terminal</h2>
        <p>
          This third-party app requires a small BLEND payment on Fluent Testnet before
          unlocking the strategy dashboard.
        </p>

        <div className="blend-requirement">
          <span>Required payment</span>
          <strong>
            {BLEND_PAYMENT_AMOUNT} {tokenSymbol}
          </strong>
        </div>

        <div className="blend-actions">
          {accountAddress ? (
            <button type="button" onClick={refreshBalance} disabled={busy}>
              Refresh balance
            </button>
          ) : (
            <button type="button" onClick={onConnect}>
              Connect to pay
            </button>
          )}
          <button type="button" onClick={payWithWallet} disabled={!canSendPayment || !hasEnoughBlend || busy}>
            {busy ? "Paying" : hasEnoughBlend ? "Ready to PAY" : "Pay with BLEND"}
          </button>
        </div>

        <p className="blend-status">{status}</p>
        {txHash ? (
          <a className="blend-link" href={explorerTx(txHash)} target="_blank" rel="noreferrer">
            View payment transaction
          </a>
        ) : null}
      </div>

      <aside className="blend-app-side">
        <div>
          <span>Connected account</span>
          <strong>{accountAddress ? formatAddress(accountAddress) : "Not connected"}</strong>
        </div>
        <div>
          <span>BLEND balance</span>
          <strong>
            {balance === null ? "Unknown" : `${formatUnits(balance, tokenDecimals)} ${tokenSymbol}`}
          </strong>
        </div>
        <div>
          <span>Payment recipient</span>
          <a href={explorerAddress(BLEND_PAYMENT_RECIPIENT)} target="_blank" rel="noreferrer">
            {formatAddress(BLEND_PAYMENT_RECIPIENT)}
          </a>
        </div>
        <div>
          <span>BLEND token</span>
          <a href={explorerAddress(BLEND_TOKEN_ADDRESS)} target="_blank" rel="noreferrer">
            {formatAddress(BLEND_TOKEN_ADDRESS)}
          </a>
        </div>
        <div>
          <span>Payment execution</span>
          <strong>{canSendPayment ? "Wallet signer ready" : "Connect external wallet to sign"}</strong>
        </div>
      </aside>
    </section>
  );
}

function ConnectChoiceModal({
  open,
  wallet,
  onClose,
  onFluentLogin,
  fluentReady,
}: {
  open: boolean;
  wallet: ReownWalletState | null;
  onClose: () => void;
  onFluentLogin: () => void;
  fluentReady: boolean;
}) {
  if (!open) return null;
  const walletOptions = [
    { label: "MetaMask", icon: METAMASK_ICON },
    { label: "Rabby", mark: "R" },
    { label: "Keplr", mark: "K" },
    { label: "Coinbase", icon: COINBASE_ICON },
    { label: "WalletConnect", icon: WALLETCONNECT_ICON },
    { label: "OKX Wallet", mark: "OKX" },
  ];
  const openWallet = () => {
    wallet?.open();
    onClose();
  };

  return (
    <div
      className="connect-choice-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="connect-choice" role="dialog" aria-modal="true" aria-label="Connect">
        <div className="connect-choice-header">
          <div>
            <h2>Connect</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            x
          </button>
        </div>

        <div className="connect-choice-grid">
          <div className="connect-wallet-panel">
            <h3>Connect Wallet</h3>
            <p>Choose a wallet through WalletConnect.</p>
            <div className="wallet-option-grid">
              {walletOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="wallet-option"
                  disabled={!wallet?.configured}
                  onClick={openWallet}
                >
                  <span className="wallet-option-mark">
                    {option.icon ? <img src={option.icon} alt="" /> : option.mark}
                  </span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            {!wallet?.configured ? (
              <p className="connect-choice-hint">
                Set VITE_REOWN_PROJECT_ID or VITE_WALLETCONNECT_PROJECT_ID.
              </p>
            ) : null}
          </div>

          <button
            type="button"
            className="connect-fluent-panel"
            disabled={!fluentReady}
            onClick={() => {
              onFluentLogin();
              onClose();
            }}
          >
            <span className="connect-choice-mark connect-choice-mark-logo">
              <img src={FLUENT_LOGO} alt="" />
            </span>
            <strong>Fluent Connect ID</strong>
            <span>Privy ID, embedded wallet, BLEND onboarding</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function ThirdPartyDemo({ wallet }: { wallet: ReownWalletState | null }) {
  const [session, setSession] = useState<FluentWidgetSession | null>(null);
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [privyIdentityToken, setPrivyIdentityToken] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const fluentWalletAddress = session?.wallet.signerAddress;
  const connectedAddress = wallet?.connected && wallet.address ? wallet.address : fluentWalletAddress;
  const hasConnectedAccount = Boolean(wallet?.connected || session?.user?.id || session?.wallet?.signerAddress);
  const widgetScopes = useMemo(() => ["openid", "profile", "wallet", "faucet"], []);
  const openConnectFlow = useCallback(() => {
    setAccountOpen(false);
    setConnectOpen(true);
  }, []);
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
    setWalletStatus("Disconnected");
    if (wallet?.connected) wallet.disconnect();
  }, [wallet]);

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
	        FLUENT_FAUCET_ENDPOINT,
	        { visitorId: getAnonymousId() },
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
  }, [privyIdentityToken, session]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== new URL(HOSTED_AUTHORIZE_URL, window.location.href).origin) return;
      if (!event.data || event.data.type !== "fluent:connect:session") return;
      setSession(event.data.session as FluentWidgetSession);
      setPrivyIdentityToken(
        typeof event.data.privyIdentityToken === "string" ? event.data.privyIdentityToken : null,
      );
	      setWalletStatus("Wallet connected");
      setHostedError(null);
      setConnectOpen(false);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const openHostedFluentConnect = useCallback(() => {
    const state = crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = new URL(HOSTED_AUTHORIZE_URL, window.location.href);
    url.searchParams.set("client_id", FLUENT_CLIENT_ID);
    url.searchParams.set("scope", widgetScopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", window.location.href);
    url.searchParams.set("source", "demo_widget");
    url.searchParams.set("campaign", "hosted-connect-demo");

    const popup = window.open(
      url.toString(),
      "fluent_connect",
      "popup=yes,width=460,height=680,left=120,top=80",
    );
    if (!popup) {
      setHostedError("Popup blocked. Allow popups and try again.");
    }
  }, [widgetScopes]);

  return (
    <>
      <div
        className="wallet-control"
        onMouseEnter={() => {
          if (hasConnectedAccount) setAccountOpen(true);
        }}
        onMouseLeave={() => setAccountOpen(false)}
      >
        <button
          type="button"
          className={hasConnectedAccount ? "top-connect top-connect-connected" : "top-connect"}
          aria-expanded={hasConnectedAccount ? accountOpen : undefined}
          onClick={handleTopConnectClick}
          onFocus={() => {
            if (hasConnectedAccount) setAccountOpen(true);
          }}
        >
          {hasConnectedAccount ? (
            <>
              <img className="top-connect-logo" src={FLUENT_LOGO} alt="" aria-hidden="true" />
              <span className="top-connect-copy">
                <strong>Wallet Connected</strong>
                <small>Powered by Fluent</small>
              </span>
            </>
          ) : (
            "Connect Wallet"
          )}
        </button>

        {hasConnectedAccount && accountOpen ? (
          <section className="wallet-menu" aria-label="Connected account">
            <div className="wallet-menu-header">
              <span>{wallet?.connected ? "Reown AppKit" : "Fluent Connect ID"}</span>
              <strong>{connectedAddress ? formatAddress(connectedAddress) : "Connected"}</strong>
            </div>
            <div className="wallet-menu-row">
              <span>Status</span>
              <strong className="wallet-menu-status">
                <span aria-hidden="true" />
                Connected
              </strong>
            </div>
            <div className="wallet-menu-smart">
              <button type="button" disabled={faucetBusy || !session} onClick={handleFaucetClaim}>
                <strong>{faucetBusy ? "Requesting faucet" : "Faucet"}</strong>
                <span>{session ? "Claim testnet BLEND" : "Connect Fluent ID first"}</span>
              </button>
              <button type="button" onClick={() => window.open(FLUENT_PORTAL_BRIDGE_URL, "_blank", "noopener,noreferrer")}>
                <strong>Bridge</strong>
                <span>Move assets to Fluent</span>
              </button>
              <button
                type="button"
                disabled={!connectedAddress}
                onClick={() => {
                  if (connectedAddress) window.open(explorerAddress(connectedAddress), "_blank", "noopener,noreferrer");
                }}
              >
                <strong>Explorer</strong>
                <span>View connected account</span>
              </button>
            </div>
            <div className="wallet-menu-actions">
              <button type="button" onClick={wallet.open}>
                Wallet Connect
              </button>
              <button className="wallet-menu-danger" type="button" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </section>
        ) : null}
      </div>

      <div className={session ? "demo-grid" : "demo-grid demo-grid-single"}>
        <div>
          <BlendPayGate session={session} wallet={wallet} onConnect={openConnectFlow} />
        </div>

        <section className="payload">
          <div className="payload-header">
            <h2>Host app callback</h2>
            <span>{FLUENT_SESSION_ENDPOINT ? "backend" : "mock"}</span>
          </div>
          <pre>{formatSession(session)}</pre>
          <div className="payload-header payload-header-secondary">
            <h2>External wallet</h2>
            <span>{wallet?.connected ? "Reown" : "wallet"}</span>
          </div>
          <pre>{formatExternalWallet(wallet, walletStatus)}</pre>
          {hostedError ? <p className="payload-error">{hostedError}</p> : null}
        </section>
      </div>

      <ConnectChoiceModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        wallet={wallet}
        fluentReady
        onFluentLogin={() => {
          setWalletStatus("Opening hosted Fluent Connect ID");
          openHostedFluentConnect();
        }}
      />
    </>
  );
}

function ReownConnectedDemo() {
  const wallet = useReownWallet();

  return <ThirdPartyDemo wallet={wallet} />;
}

function HostedAuthorizeContent() {
  const { authenticated, getAccessToken, login, logout, ready, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [status, setStatus] = useState("Waiting for Fluent ID");
  const [sent, setSent] = useState(false);

  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const clientId = query.get("client_id") || FLUENT_CLIENT_ID;
  const scopes = useMemo(
    () => (query.get("scope") || "openid profile wallet faucet").split(" ").filter(Boolean),
    [query],
  );
  const state = query.get("state") || "";
  const redirectURI = query.get("redirect_uri") || "";
  const targetOrigin = useMemo(() => {
    try {
      return new URL(redirectURI).origin;
    } catch {
      return "";
    }
  }, [redirectURI]);

  const completeAuthorization = useCallback(async () => {
    if (!authenticated || !user?.id || sent) return;
    if (!window.opener || !targetOrigin) {
      setStatus("Missing opener or redirect origin");
      return;
    }

    setStatus("Creating Fluent session");
    try {
      if (!identityToken) {
        setStatus("Waiting for Privy identity token");
        return;
      }

      const signerAddress = getPrivyWalletAddress(user) as `0x${string}` | undefined;
      const privyAccessToken = await getAccessToken();
      const session = FLUENT_HOSTED_SESSION_ENDPOINT
        ? await postJson<FluentWidgetSession>(FLUENT_HOSTED_SESSION_ENDPOINT, {
            clientId,
            scopes,
            privyAccessToken,
            userId: user.id,
            signerAddress,
            redirectUri: redirectURI,
          })
        : createMockHostedSession({
            clientId,
            scopes,
            userId: user.id,
            signerAddress,
          });

      window.opener.postMessage(
        {
          type: "fluent:connect:session",
          state,
          session,
          privyIdentityToken: identityToken,
        },
        targetOrigin,
      );
      setSent(true);
	      setStatus("Wallet connected");
      window.setTimeout(() => window.close(), 350);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create Fluent session";
      window.opener.postMessage(
        {
          type: "fluent:connect:error",
          state,
          error: message,
        },
        targetOrigin,
      );
      setStatus(message);
    }
  }, [authenticated, clientId, getAccessToken, identityToken, scopes, sent, state, targetOrigin, user]);

  const switchAccount = useCallback(async () => {
    setStatus("Signing out of Fluent ID");
    setSent(false);
    await logout();
    setStatus("Choose another Fluent ID account");
  }, [logout]);

  return (
    <main className="authorize-page">
      <section className="authorize-panel">
        <img className="brand-logo" src={FLUENT_LOGO} alt="Fluent" />
        <h1>Fluent Connect ID</h1>
        <p className="lead">Continue with Fluent ID to connect this app.</p>
        <button
          type="button"
          disabled={!ready || sent}
          onClick={authenticated ? completeAuthorization : login}
        >
          {sent ? "Connected" : authenticated ? "Continue with current account" : ready ? "Continue" : "Loading"}
        </button>
        {authenticated ? (
          <button className="authorize-secondary" type="button" disabled={sent} onClick={switchAccount}>
            Switch account
          </button>
        ) : null}
        <p className="authorize-status">{status}</p>
      </section>
    </main>
  );
}

export default function App() {
  const hasAuthConfig = Boolean(PRIVY_APP_ID);
  const isAuthorize = window.location.pathname === "/authorize";

  if (isAuthorize) {
    return (
      <FluentConnectProvider
        privyAppId={PRIVY_APP_ID}
        chain={fluentTestnet}
        privy={{
          loginMethods: ["email", "wallet"],
          appearance: {
            landingHeader: "Log in with Fluent",
            loginMessage: "Use Fluent ID to continue.",
          },
        }}
      >
        <HostedAuthorizeContent />
      </FluentConnectProvider>
    );
  }

  return (
    <main>
      <header>
        <img className="brand-logo" src={FLUENT_LOGO} alt="Fluent" />
        <p className="eyebrow">Third-party BLEND app</p>
        <h1>Pay into Fluent with BLEND</h1>
        <p className="lead">
          A demo app that asks users to connect through Fluent, checks their BLEND
          balance on Fluent Testnet, and gates access behind a token payment.
        </p>
      </header>

      {!hasAuthConfig ? <SetupNotice /> : null}

      {hasAuthConfig ? (
        reownConfigured ? (
          <ReownProvider>
            <ReownConnectedDemo />
          </ReownProvider>
        ) : (
          <ThirdPartyDemo
            wallet={{
              configured: false,
              connected: false,
              open: () => undefined,
              disconnect: () => undefined,
              switchChain: async () => undefined,
            }}
          />
        )
      ) : (
        <section className="mock-card">
          <div className="mock-widget">
            <div className="mock-mark">F</div>
            <div>
              <strong>Log in with Fluent</strong>
              <span>Fluent ID, wallet, faucet</span>
            </div>
            <button type="button">Continue</button>
          </div>
        </section>
      )}
    </main>
  );
}
