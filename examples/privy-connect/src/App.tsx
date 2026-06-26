import {
  FluentConnectProvider,
  fluentTestnet,
  type FluentWidgetSession,
} from "@fluent/react";
import {
  createFluentFamiliesClient,
  createFluentPermissionClient,
  fluentTestnetTokenDefaults,
  readFluentTokenBalances,
  type FluentFamilies,
  type FluentPermissionGrant,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent/sdk";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, formatUnits, http, parseAbi, parseUnits, type Hash } from "viem";
import {
  ReownProvider,
  reownConfigured,
  useReownWallet,
  type ReownWalletState,
} from "./reown-appkit";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "cmi7li7v901yojv0dmtfuf0v4";
const FLUENT_CLIENT_ID = import.meta.env.VITE_FLUENT_CLIENT_ID ?? "demo_app";
const FLUENT_SESSION_ENDPOINT = import.meta.env.VITE_FLUENT_SESSION_ENDPOINT ?? "";
const FLUENT_FAUCET_ENDPOINT =
  import.meta.env.VITE_FLUENT_FAUCET_ENDPOINT ??
  "https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund";
const FLUENT_EVENTS_ENDPOINT = import.meta.env.VITE_FLUENT_EVENTS_ENDPOINT ?? "";
const FLUENT_SDK_SERVICE_URL =
  import.meta.env.VITE_FLUENT_SDK_SERVICE_URL ?? "http://localhost:5174";
const FLUENT_PUBLIC_API_URL =
  import.meta.env.VITE_FLUENT_PUBLIC_API_URL ??
  "https://fluent-connect.api.fluent.xyz/api/v1";
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
const CHESS_CONTRACT_ADDRESS = import.meta.env.VITE_CHESS_CONTRACT_ADDRESS as
  | `0x${string}`
  | undefined;
const CHESS_GAME_ID = BigInt(import.meta.env.VITE_CHESS_GAME_ID ?? "1");
const CHESS_FROM_BLOCK = BigInt(import.meta.env.VITE_CHESS_FROM_BLOCK ?? "0");
const CHESS_TREASURY_ADDRESS = (import.meta.env.VITE_CHESS_TREASURY_ADDRESS ||
  "0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E") as `0x${string}`;
const CHESS_OPERATOR_ADDRESS = import.meta.env.VITE_CHESS_OPERATOR_ADDRESS as
  | `0x${string}`
  | undefined;
const CHESS_MOVE_PRICE = parseUnits("1", 18);
const BLEND_PAYMENT_AMOUNT = "1";
const BLEND_PAYMENT_RECIPIENT = (import.meta.env.VITE_BLEND_PAY_RECIPIENT ||
  "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4") as `0x${string}`;
const USDNR_TOKEN_ADDRESS = import.meta.env.VITE_USDNR_TOKEN_ADDRESS as
  | `0x${string}`
  | undefined;
const blendPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(),
});

const FAMILY_LABELS: Record<string, Record<string, string>> = {
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
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
const chessAbi = parseAbi([
  "event GameCreated(uint256 indexed gameId,address indexed white,address indexed black)",
  "event MoveSubmitted(uint256 indexed gameId,uint256 indexed moveNumber,address indexed player,address operator,string moveUci,string fenAfterMove)",
  "function createGame(address blackPlayer) returns (uint256 gameId)",
  "function approveOperator(uint256 gameId,address operator,bool approved)",
  "function games(uint256 gameId) view returns (address white,address black,address turn,bool active,uint64 moveCount,uint8 result)",
  "function operators(uint256 gameId,address player,address operator) view returns (bool)",
]);
const chessPieces: Record<string, string> = {
  p: "♟",
  r: "♜",
  n: "♞",
  b: "♝",
  q: "♛",
  k: "♚",
  P: "♙",
  R: "♖",
  N: "♘",
  B: "♗",
  Q: "♕",
  K: "♔",
};

const demoTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.ETH,
  {
    ...fluentTestnetTokenDefaults.USDnr,
    address: USDNR_TOKEN_ADDRESS,
  },
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.USDC,
  fluentTestnetTokenDefaults.USDT,
];

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

function WalletMenuBalances({ accountAddress }: { accountAddress?: `0x${string}` }) {
  const [balances, setBalances] = useState<FluentTokenBalance[]>([]);
  const [status, setStatus] = useState("Connect a wallet to load balances");
  const [busy, setBusy] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accountAddress) {
      setBalances([]);
      setStatus("Connect a wallet to load balances");
      return;
    }

    setBusy(true);
    setStatus("Reading Fluent Testnet balances");
    const next = await readFluentTokenBalances({
      client: blendPublicClient,
      account: accountAddress,
      tokens: demoTokens,
    });
    setBalances(next);
    setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    setBusy(false);
  }, [accountAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copyAddress = useCallback(async (address: `0x${string}`) => {
    await navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    window.setTimeout(() => {
      setCopiedAddress((current) => (current === address ? null : current));
    }, 1400);
  }, []);

  return (
    <div className="wallet-menu-balances">
      <button className="wallet-menu-balances-trigger" type="button">
        <div>
          <strong>Balances</strong>
          <span>Portfolio on Fluent Testnet</span>
        </div>
        <span className="wallet-menu-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <section className="wallet-menu-balances-panel" aria-label="Token balances on Fluent Testnet">
        <div className="wallet-menu-balances-header">
          <div>
            <strong>Token balances</strong>
            <span>Network: Fluent Testnet</span>
          </div>
          <button type="button" onClick={refresh} disabled={!accountAddress || busy}>
            {busy ? "..." : "Refresh"}
          </button>
        </div>

        <div className="wallet-token-list">
          {demoTokens.map((token) => {
            const balance = balances.find((item) => item.symbol === token.symbol);
            const unavailable = balance?.status === "not-configured";
            const failed = balance?.status === "error";
            return (
              <div className="wallet-token-row" key={token.symbol}>
                <span className={`token-mark token-mark-${token.symbol.toLowerCase()}`}>
                  {token.symbol.slice(0, 1)}
                </span>
                <span className="wallet-token-name">
                  <strong>{token.symbol}</strong>
                  <small>
                    {balance?.status === "ready"
                      ? balance.formatted
                      : unavailable
                        ? "Not configured"
                        : failed
                          ? "Unavailable"
                          : accountAddress
                            ? "Loading"
                            : "Connect"}
                  </small>
                </span>
                {token.address ? (
                  <button
                    className="wallet-token-copy"
                    type="button"
                    title={`Copy ${token.symbol} address`}
                    onClick={() => void copyAddress(token.address!)}
                  >
                    <span>{copiedAddress === token.address ? "Copied" : formatAddress(token.address)}</span>
                    <span aria-hidden="true">⧉</span>
                  </button>
                ) : (
                  <span className="wallet-token-native">
                    {token.symbol === "ETH" ? "Native" : "No address"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p>{status}</p>
      </section>
    </div>
  );
}

function ChessDemo({
  session,
  wallet,
  onConnect,
}: {
  session: FluentWidgetSession | null;
  wallet: ReownWalletState | null;
  onConnect: () => void;
}) {
  const [fen, setFen] = useState("start");
  const [lastMove, setLastMove] = useState("Waiting for first move");
  const [status, setStatus] = useState(
    CHESS_CONTRACT_ADDRESS ? "Watching Fluent Testnet" : "Deploy chess contract to enable live mode",
  );
  const [setupStatus, setSetupStatus] = useState("Create a game to start the bot demo");
  const [setupBusy, setSetupBusy] = useState(false);
  const [whiteAllowanceReady, setWhiteAllowanceReady] = useState(false);
  const [whiteOperatorReady, setWhiteOperatorReady] = useState(false);
  const [gameMeta, setGameMeta] = useState<{
    white?: string;
    black?: string;
    turn?: string;
    moveCount?: bigint;
    active?: boolean;
  }>({});

  const refreshChess = useCallback(async () => {
    if (!CHESS_CONTRACT_ADDRESS) return;

    try {
      const game = await blendPublicClient.readContract({
        address: CHESS_CONTRACT_ADDRESS,
        abi: chessAbi,
        functionName: "games",
        args: [CHESS_GAME_ID],
      });
      const [white, black, turn, active, moveCount] = game;
      setGameMeta({ white, black, turn, active, moveCount });
      const gameCreated = white !== "0x0000000000000000000000000000000000000000";
      if (gameCreated && wallet?.address && CHESS_CONTRACT_ADDRESS) {
        const allowance = await blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet.address as `0x${string}`, CHESS_CONTRACT_ADDRESS],
        });
        setWhiteAllowanceReady(allowance >= CHESS_MOVE_PRICE);
      } else {
        setWhiteAllowanceReady(false);
      }
      if (gameCreated && wallet?.address && CHESS_OPERATOR_ADDRESS) {
        const approved = await blendPublicClient.readContract({
          address: CHESS_CONTRACT_ADDRESS,
          abi: chessAbi,
          functionName: "operators",
          args: [CHESS_GAME_ID, wallet.address as `0x${string}`, CHESS_OPERATOR_ADDRESS],
        });
        setWhiteOperatorReady(approved);
      } else {
        setWhiteOperatorReady(false);
      }

      const events = await blendPublicClient.getContractEvents({
        address: CHESS_CONTRACT_ADDRESS,
        abi: chessAbi,
        eventName: "MoveSubmitted",
        args: { gameId: CHESS_GAME_ID },
        fromBlock: CHESS_FROM_BLOCK,
        toBlock: "latest",
      });
      const latest = events
        .map((event) => event.args)
        .filter((args) => args.gameId === CHESS_GAME_ID)
        .sort((a, b) => Number((a.moveNumber ?? 0n) - (b.moveNumber ?? 0n)))
        .at(-1);

      setFen(latest?.fenAfterMove || "start");
      setLastMove(
        latest?.moveUci
          ? `${latest.moveUci} by ${latest.player ? formatAddress(latest.player) : "player"}`
          : "Waiting for first move",
      );
      setStatus(gameCreated ? (active ? "Live on Fluent Testnet" : "Game finished") : "Contract deployed; create game");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not read chess game");
    }
  }, [wallet?.address]);

  useEffect(() => {
    void refreshChess();
    const timer = window.setInterval(() => void refreshChess(), 1800);
    return () => window.clearInterval(timer);
  }, [refreshChess]);

  const board = parseChessBoard(fen);
  const connected = session?.wallet.signerAddress;
  const gameCreated = Boolean(
    gameMeta.white && gameMeta.white !== "0x0000000000000000000000000000000000000000",
  );
  const canCreateGame = Boolean(
    CHESS_CONTRACT_ADDRESS &&
      wallet?.connected &&
      wallet.address &&
      wallet.walletClient &&
      session?.wallet.signerAddress &&
      !gameCreated,
  );

  const ensureFluentChain = useCallback(async () => {
    if (!wallet) return;
    if (wallet.chainId !== fluentTestnet.id) {
      setSetupStatus("Switching wallet to Fluent Testnet");
      await wallet.switchChain(fluentTestnet.id);
    }
  }, [wallet]);

  const createGame = useCallback(async () => {
    if (!CHESS_CONTRACT_ADDRESS) {
      setSetupStatus("Chess contract address is not configured");
      return;
    }
    if (!wallet?.walletClient || !wallet.address) {
      setSetupStatus("Connect an external wallet to create the white player");
      onConnect();
      return;
    }
    if (!session?.wallet.signerAddress) {
      setSetupStatus("Connect Fluent ID first. The embedded wallet becomes black.");
      return;
    }

    setSetupBusy(true);
    try {
      await ensureFluentChain();
      setSetupStatus("Waiting for createGame signature");
      const hash = await wallet.walletClient.writeContract({
        account: wallet.address as `0x${string}`,
        chain: fluentTestnet,
        address: CHESS_CONTRACT_ADDRESS,
        abi: chessAbi,
        functionName: "createGame",
        args: [session.wallet.signerAddress],
      });
      setSetupStatus(`Game creation submitted: ${formatAddress(hash)}`);
      await blendPublicClient.waitForTransactionReceipt({ hash });
      setSetupStatus("Game created. Grant permissions and approvals before starting bots.");
      await refreshChess();
    } catch (error) {
      setSetupStatus(error instanceof Error ? error.message : "Could not create game");
    } finally {
      setSetupBusy(false);
    }
  }, [ensureFluentChain, onConnect, refreshChess, session, wallet]);

  const approveBlend = useCallback(async () => {
    if (!CHESS_CONTRACT_ADDRESS || !wallet?.walletClient || !wallet.address) return;
    setSetupBusy(true);
    try {
      await ensureFluentChain();
      setSetupStatus("Approving BLEND spend for chess moves");
      const hash = await wallet.walletClient.writeContract({
        account: wallet.address as `0x${string}`,
        chain: fluentTestnet,
        address: BLEND_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [CHESS_CONTRACT_ADDRESS, parseUnits("50", 18)],
      });
      await blendPublicClient.waitForTransactionReceipt({ hash });
      setSetupStatus("White player BLEND allowance is ready");
      await refreshChess();
    } catch (error) {
      setSetupStatus(error instanceof Error ? error.message : "Could not approve BLEND");
    } finally {
      setSetupBusy(false);
    }
  }, [ensureFluentChain, refreshChess, wallet]);

  const approveOperator = useCallback(async () => {
    if (!CHESS_CONTRACT_ADDRESS || !CHESS_OPERATOR_ADDRESS || !wallet?.walletClient || !wallet.address) return;
    setSetupBusy(true);
    try {
      await ensureFluentChain();
      setSetupStatus("Approving the white bot operator");
      const hash = await wallet.walletClient.writeContract({
        account: wallet.address as `0x${string}`,
        chain: fluentTestnet,
        address: CHESS_CONTRACT_ADDRESS,
        abi: chessAbi,
        functionName: "approveOperator",
        args: [CHESS_GAME_ID, CHESS_OPERATOR_ADDRESS, true],
      });
      await blendPublicClient.waitForTransactionReceipt({ hash });
      setSetupStatus("White bot operator is approved");
      await refreshChess();
    } catch (error) {
      setSetupStatus(error instanceof Error ? error.message : "Could not approve operator");
    } finally {
      setSetupBusy(false);
    }
  }, [ensureFluentChain, refreshChess, wallet]);

  return (
    <section className="chess-panel">
      <div className="chess-panel-copy">
        <p className="eyebrow">Permissioned bot demo</p>
        <h2>
          <span aria-hidden="true">♞</span>
          Fluent Chess Blitz
        </h2>
        <p>
          Two bots play an on-chain chess game. Every move pays 1 BLEND and emits a
          Fluent Testnet event that updates this board.
        </p>
        <div className="chess-stats">
          <div>
            <span>White</span>
            <strong>{gameMeta.white ? formatAddress(gameMeta.white) : "Deployer"}</strong>
          </div>
          <div>
            <span>Black</span>
            <strong>{gameMeta.black ? formatAddress(gameMeta.black) : "Fluent wallet"}</strong>
          </div>
          <div>
            <span>Turn</span>
            <strong>{gameMeta.turn ? formatAddress(gameMeta.turn) : "White"}</strong>
          </div>
          <div>
            <span>Moves</span>
            <strong>{gameMeta.moveCount?.toString() ?? "0"}</strong>
          </div>
        </div>
        <div className="chess-actions">
          <span>{status}</span>
          <strong>{lastMove}</strong>
        </div>
        <div className="chess-setup-actions">
          {!wallet?.connected ? (
            <button type="button" onClick={onConnect}>
              Connect deployer wallet
            </button>
          ) : null}
          <button type="button" onClick={createGame} disabled={!canCreateGame || setupBusy}>
            {gameCreated ? "Game created" : setupBusy ? "Creating" : "Create game"}
          </button>
          <button
            type="button"
            onClick={approveBlend}
            disabled={!gameCreated || !wallet?.walletClient || whiteAllowanceReady || setupBusy}
          >
            {whiteAllowanceReady ? "BLEND approved" : "Approve BLEND"}
          </button>
          <button
            type="button"
            onClick={approveOperator}
            disabled={!gameCreated || !CHESS_OPERATOR_ADDRESS || !wallet?.walletClient || whiteOperatorReady || setupBusy}
          >
            {whiteOperatorReady ? "Bot approved" : "Approve white bot"}
          </button>
        </div>
        <p className="chess-session">{setupStatus}</p>
        <p className="chess-session">
          {connected
            ? `Fluent session: ${formatAddress(connected)}`
            : "Connect with Fluent ID to grant bot permissions."}
        </p>
      </div>

      <div className="chess-board" aria-label="Chess board">
        {board.map((piece, index) => {
          const file = index % 8;
          const rank = Math.floor(index / 8);
          const dark = (file + rank) % 2 === 1;
          return (
            <span
              className={dark ? "chess-square chess-square-dark" : "chess-square"}
              key={`${index}-${piece || "empty"}`}
            >
              {piece ? chessPieces[piece] : ""}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function parseChessBoard(fen: string) {
  const boardPart =
    fen === "start" || !fen
      ? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
      : fen.split(" ")[0];
  const squares: string[] = [];
  for (const rank of boardPart.split("/")) {
    for (const char of rank) {
      const empty = Number(char);
      if (Number.isInteger(empty) && empty > 0) {
        for (let i = 0; i < empty; i += 1) squares.push("");
      } else {
        squares.push(char);
      }
    }
  }
  return squares.slice(0, 64);
}

function PermissionDemo({
  session,
  compact = false,
}: {
  session: FluentWidgetSession | null;
  compact?: boolean;
}) {
  const [grants, setGrants] = useState<FluentPermissionGrant[]>([]);
  const [status, setStatus] = useState("Connect with Fluent ID to create a permissioned session");
  const [busy, setBusy] = useState(false);
  const client = useMemo(() => {
    if (!session) return null;
    return createFluentPermissionClient({
      baseUrl: FLUENT_SDK_SERVICE_URL,
      clientId: FLUENT_CLIENT_ID,
      getSessionToken: () => session.idToken,
    });
  }, [session]);

  const loadGrants = useCallback(async () => {
    if (!client) {
      setGrants([]);
      return;
    }
    try {
      setGrants(await client.list());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load permissions");
    }
  }, [client]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const createGrant = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setStatus("Validating requested permissions");
    const request = {
      appId: "fluent_chess_blitz",
      expiry: Math.floor(Date.now() / 1000) + 3600,
      permissions: {
        calls: [
          {
            chainId: fluentTestnet.id,
            to: CHESS_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000",
            function: "submitMove(uint256,string,string)",
            selector: "0xe04f1d81" as const,
          },
        ],
        spend: [
          {
            chainId: fluentTestnet.id,
            token: BLEND_TOKEN_ADDRESS,
            symbol: "BLEND",
            limit: "60",
            period: "hour" as const,
            recipients: [CHESS_TREASURY_ADDRESS],
          },
        ],
      },
    };

    try {
      await client.preview(request);
      setStatus("Creating one-hour permission grant");
      const grant = await client.grant(request);
      setGrants((current) => [grant, ...current.filter((item) => item.id !== grant.id)]);
      setStatus("Permission active. The bot is limited to chess moves and 60 BLEND per hour.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not grant permissions");
    } finally {
      setBusy(false);
    }
  }, [client]);

  const revoke = useCallback(
    async (grantId: string) => {
      if (!client) return;
      setBusy(true);
      setStatus("Revoking permission");
      try {
        const revoked = await client.revoke(grantId);
        setGrants((current) =>
          current.map((grant) => (grant.id === revoked.id ? revoked : grant)),
        );
        setStatus("Permission revoked");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not revoke permission");
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const activeGrant = grants.find((grant) => grant.status === "active");

  return (
    <section className={compact ? "permission-panel permission-panel-compact" : "sdk-panel permission-panel"}>
      <div className="sdk-panel-header">
        <div>
          <p className="eyebrow">Permissioned session</p>
          <h2>Fluent Chess Blitz</h2>
        </div>
        <span className={`permission-state ${activeGrant ? "permission-state-active" : ""}`}>
          {activeGrant ? "Active" : "Not granted"}
        </span>
      </div>

      <div className="permission-summary">
        <div>
          <span>Allowed call</span>
          <strong>BlendChessGame.submitMove</strong>
        </div>
        <div>
          <span>Spend limit</span>
          <strong>60 BLEND / hour</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>1 hour</strong>
        </div>
        <div>
          <span>Treasury</span>
          <strong>{formatAddress(CHESS_TREASURY_ADDRESS)}</strong>
        </div>
      </div>

      {activeGrant ? (
        <div className="permission-active">
          <div>
            <span>Grant ID</span>
            <strong>{activeGrant.id}</strong>
          </div>
          <div>
            <span>Expires</span>
            <strong>{new Date(activeGrant.expiry * 1000).toLocaleTimeString()}</strong>
          </div>
          <button type="button" onClick={() => revoke(activeGrant.id)} disabled={busy}>
            Revoke permission
          </button>
        </div>
      ) : (
        <button
          className="permission-grant-button"
          type="button"
          onClick={createGrant}
          disabled={!session || busy}
        >
          {busy ? "Creating permission" : "Grant chess bot permission"}
        </button>
      )}
      <p className="sdk-panel-status">{status}</p>
    </section>
  );
}

function WalletMenuActionCard({
  session,
  connectedAddress,
  faucetBusy,
  onFaucet,
}: {
  session: FluentWidgetSession | null;
  connectedAddress: string | undefined;
  faucetBusy: boolean;
  onFaucet: () => void;
}) {
  const [result, setResult] = useState<FluentFamilies | null>(null);
  const [status, setStatus] = useState("Connect with Fluent ID to load families");
  const [cardMode, setCardMode] = useState<"actions" | "permissions" | "reputation">("actions");
  const client = useMemo(() => {
    if (!session?.wallet.signerAddress) return null;
    return createFluentFamiliesClient({
      baseUrl: FLUENT_PUBLIC_API_URL,
    });
  }, [session]);

  useEffect(() => {
    if (!client) {
      setResult(null);
      setStatus("Connect with Fluent ID to load families");
      return;
    }

    let active = true;
    setStatus("Loading Fluent families");
    void client
      .getFamilies(session?.wallet.signerAddress ?? "")
      .then((families) => {
        if (!active) return;
        setResult(families);
        setStatus("Families loaded from Fluent Connect");
      })
      .catch((error) => {
        if (!active) return;
        setResult(null);
        setStatus(error instanceof Error ? error.message : "Could not load families");
      });
    return () => {
      active = false;
    };
  }, [client]);
  const flipped = cardMode !== "actions";
  const toggleMode = (mode: "permissions" | "reputation") => {
    setCardMode((current) => (current === mode ? "actions" : mode));
  };

  return (
    <div className={`wallet-menu-action-card ${flipped ? "wallet-menu-action-card-flipped" : ""}`}>
      <button
        className="wallet-menu-reputation-trigger"
        type="button"
        aria-pressed={cardMode === "permissions"}
        onClick={() => toggleMode("permissions")}
      >
        <span className="wallet-menu-reputation-title">
          <img src={FLUENT_LOGO} alt="" aria-hidden="true" />
          <span>Permissions</span>
        </span>
        <span className="wallet-menu-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <button
        className="wallet-menu-reputation-trigger"
        type="button"
        aria-pressed={cardMode === "reputation"}
        onClick={() => toggleMode("reputation")}
      >
        <span className="wallet-menu-reputation-title">
          <img src={FLUENT_LOGO} alt="" aria-hidden="true" />
          <span>Reputation</span>
        </span>
        <span className="wallet-menu-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <section className="wallet-menu-flip-card" aria-label="Fluent account actions and reputation">
        <div className="wallet-menu-flip-card-inner">
          <div className="wallet-menu-flip-face wallet-menu-flip-front">
            <div className="wallet-menu-smart">
              <button type="button" disabled={faucetBusy || !session} onClick={onFaucet}>
                <strong>{faucetBusy ? "Requesting faucet" : "Faucet"}</strong>
                <span>{session ? "Claim testnet BLEND" : "Connect Fluent ID first"}</span>
              </button>
              <button
                type="button"
                onClick={() => window.open(FLUENT_PORTAL_BRIDGE_URL, "_blank", "noopener,noreferrer")}
              >
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
              <WalletMenuBalances
                accountAddress={connectedAddress as `0x${string}` | undefined}
              />
            </div>
          </div>
          <div className="wallet-menu-flip-face wallet-menu-flip-back">
            {cardMode === "permissions" ? (
              <PermissionDemo session={session} compact />
            ) : (
              <>
                <div className="wallet-family-grid">
                  {result
                    ? Object.entries(result.families).map(([name, family]) => (
                        <div
                          className={`wallet-family-card wallet-family-tier-${family.tier.toLowerCase()}`}
                          key={name}
                        >
                          <strong className="wallet-family-name">{name}</strong>
                          <strong>Tier {family.tier}</strong>
                          <small>{FAMILY_LABELS[name]?.[family.tier] ?? "Reputation signal"}</small>
                        </div>
                      ))
                    : null}
                </div>
                <p>{status}</p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
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

function ThirdPartyDemo({
  wallet,
  view = "home",
}: {
  wallet: ReownWalletState | null;
  view?: "home" | "chess";
}) {
  const [session, setSession] = useState<FluentWidgetSession | null>(null);
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [privyIdentityToken, setPrivyIdentityToken] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const accountCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fluentWalletAddress = session?.wallet.signerAddress;
  const connectedAddress = wallet?.connected && wallet.address ? wallet.address : fluentWalletAddress;
  const hasConnectedAccount = Boolean(wallet?.connected || session?.user?.id || session?.wallet?.signerAddress);
  const widgetScopes = useMemo(
    () => ["openid", "profile", "wallet", "faucet"],
    [],
  );
  const openConnectFlow = useCallback(() => {
    if (accountCloseTimer.current) {
      clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
    setAccountOpen(false);
    setConnectOpen(true);
  }, []);
  const openAccountMenu = useCallback(() => {
    if (accountCloseTimer.current) {
      clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
    if (hasConnectedAccount) setAccountOpen(true);
  }, [hasConnectedAccount]);
  const scheduleAccountMenuClose = useCallback(() => {
    if (accountCloseTimer.current) clearTimeout(accountCloseTimer.current);
    accountCloseTimer.current = setTimeout(() => {
      setAccountOpen(false);
      accountCloseTimer.current = null;
    }, 250);
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
  }, [privyIdentityToken, session]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== new URL(HOSTED_AUTHORIZE_URL, window.location.href).origin) return;
      if (!event.data || event.data.type !== "fluent:connect:session") return;
      setSession(event.data.session as FluentWidgetSession);
      setPrivyIdentityToken(
        typeof event.data.privyIdentityToken === "string" ? event.data.privyIdentityToken : null,
      );
      setWalletStatus("Wallet connected!");
      setHostedError(null);
      setConnectOpen(false);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    return () => {
      if (accountCloseTimer.current) clearTimeout(accountCloseTimer.current);
    };
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
        onMouseEnter={openAccountMenu}
        onMouseLeave={scheduleAccountMenuClose}
      >
        <button
          type="button"
          className={hasConnectedAccount ? "top-connect top-connect-connected" : "top-connect"}
          aria-expanded={hasConnectedAccount ? accountOpen : undefined}
          onClick={handleTopConnectClick}
          onFocus={() => {
            openAccountMenu();
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
            <WalletMenuActionCard
              session={session}
              connectedAddress={connectedAddress}
              faucetBusy={faucetBusy}
              onFaucet={handleFaucetClaim}
            />
            <div className="wallet-menu-actions">
              <button type="button" onClick={() => wallet?.open()}>
                Wallet Connect
              </button>
              <button className="wallet-menu-danger" type="button" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {view === "chess" ? (
        <div className="chess-page">
          <ChessDemo session={session} wallet={wallet} onConnect={openConnectFlow} />
        </div>
      ) : (
        <div className="demo-grid">
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
      )}

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

function ReownConnectedDemo({ view }: { view?: "home" | "chess" }) {
  const wallet = useReownWallet();

  return <ThirdPartyDemo wallet={wallet} view={view} />;
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

      const privyAccessToken = await getAccessToken();
      const session = FLUENT_HOSTED_SESSION_ENDPOINT
        ? await postJson<FluentWidgetSession>(FLUENT_HOSTED_SESSION_ENDPOINT, {
            clientId,
            scopes,
            privyAccessToken,
            privyIdentityToken: identityToken,
            redirectUri: redirectURI,
          })
        : createMockHostedSession({
            clientId,
            scopes,
            userId: user.id,
            signerAddress: getPrivyWalletAddress(user) as `0x${string}` | undefined,
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
      setStatus("Wallet connected!");
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
  const isChess = window.location.pathname === "/chess";

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
    <main className={isChess ? "main-chess" : undefined}>
      <header>
        <img className="brand-logo" src={FLUENT_LOGO} alt="Fluent" />
        {isChess ? (
          <>
            <p className="eyebrow">On-chain bot demo</p>
            <h1>Fluent Chess Blitz</h1>
            <p className="lead">
              Watch two permissioned bots play chess on Fluent Testnet with every move
              submitted as a fast BLEND-paid transaction.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">Third-party BLEND app</p>
            <h1>Pay into Fluent with BLEND</h1>
            <p className="lead">
              A demo app that asks users to connect through Fluent, checks their BLEND
              balance on Fluent Testnet, and gates access behind a token payment.
            </p>
          </>
        )}
      </header>

      {!hasAuthConfig ? <SetupNotice /> : null}

      {hasAuthConfig ? (
        reownConfigured ? (
          <ReownProvider>
            <ReownConnectedDemo view={isChess ? "chess" : "home"} />
          </ReownProvider>
        ) : (
          <ThirdPartyDemo
            view={isChess ? "chess" : "home"}
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
