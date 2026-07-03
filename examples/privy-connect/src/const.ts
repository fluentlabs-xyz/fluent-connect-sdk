import { fluentTestnet, fluentTestnetTokenDefaults, FluentTokenDefinition } from "@fluent/connect-sdk";
import { PrivyClientConfig } from "@privy-io/react-auth";
import { parseUnits, createPublicClient, http, parseAbi } from "viem";

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "cmi7li7v901yojv0dmtfuf0v4";
export const FLUENT_CLIENT_ID = import.meta.env.VITE_FLUENT_CLIENT_ID ?? "demo_app";
export const FLUENT_SESSION_ENDPOINT = import.meta.env.VITE_FLUENT_SESSION_ENDPOINT ?? "";
export const FLUENT_FAUCET_ENDPOINT =
  import.meta.env.VITE_FLUENT_FAUCET_ENDPOINT ??
  "https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund";
export const FLUENT_EVENTS_ENDPOINT = import.meta.env.VITE_FLUENT_EVENTS_ENDPOINT ?? "";
export const FLUENT_SDK_SERVICE_URL =
  import.meta.env.VITE_FLUENT_SDK_SERVICE_URL ?? "http://localhost:5174";
export const FLUENT_PUBLIC_API_URL =
  import.meta.env.VITE_FLUENT_PUBLIC_API_URL ??
  "https://fluent-connect.api.fluent.xyz/api/v1";
export const FLUENT_LOGO = "/fluent-assets/fluent-logo.svg";
export const WALLETCONNECT_ICON = "/fluent-assets/walletconnect.svg";
export const METAMASK_ICON = "/fluent-assets/metamask.svg";
export const COINBASE_ICON = "/fluent-assets/coinbase.svg";
export const FLUENT_PORTAL_BRIDGE_URL = "https://fluent-mainnet-dev.vercel.app/user/bridge";
export const HOSTED_AUTHORIZE_URL =
  import.meta.env.VITE_FLUENT_AUTHORIZE_URL ?? `${location.origin}/authorize`;
export const FLUENT_HOSTED_SESSION_ENDPOINT =
  import.meta.env.VITE_FLUENT_HOSTED_SESSION_ENDPOINT ?? "";
export const BLEND_TOKEN_ADDRESS = "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const;
export const CHESS_CONTRACT_ADDRESS = import.meta.env.VITE_CHESS_CONTRACT_ADDRESS as
  | `0x${string}`
  | undefined;
export const CHESS_GAME_ID = BigInt(import.meta.env.VITE_CHESS_GAME_ID ?? "1");
export const CHESS_FROM_BLOCK = BigInt(import.meta.env.VITE_CHESS_FROM_BLOCK ?? "0");
export const CHESS_TREASURY_ADDRESS = (import.meta.env.VITE_CHESS_TREASURY_ADDRESS ||
  "0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E") as `0x${string}`;
export const CHESS_OPERATOR_ADDRESS = import.meta.env.VITE_CHESS_OPERATOR_ADDRESS as
  | `0x${string}`
  | undefined;
export const CHESS_MOVE_PRICE = parseUnits("1", 18);
export const BLEND_PAYMENT_AMOUNT = "1";
export const BLEND_PAYMENT_RECIPIENT = (import.meta.env.VITE_BLEND_PAY_RECIPIENT ||
  "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4") as `0x${string}`;
export const USDNR_TOKEN_ADDRESS = import.meta.env.VITE_USDNR_TOKEN_ADDRESS as
  | `0x${string}`
  | undefined;
export const blendPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(),
});
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

export const FAMILY_LABELS: Record<string, Record<string, string>> = {
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

export const chessPieces: Record<string, string> = {
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


export const erc20Abi = [
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
export const chessAbi = parseAbi([
  "event GameCreated(uint256 indexed gameId,address indexed white,address indexed black)",
  "event MoveSubmitted(uint256 indexed gameId,uint256 indexed moveNumber,address indexed player,address operator,string moveUci,string fenAfterMove)",
  "function createGame(address blackPlayer) returns (uint256 gameId)",
  "function approveOperator(uint256 gameId,address operator,bool approved)",
  "function games(uint256 gameId) view returns (address white,address black,address turn,bool active,uint64 moveCount,uint8 result)",
  "function operators(uint256 gameId,address player,address operator) view returns (bool)",
]);


export const demoTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.ETH,
  {
    ...fluentTestnetTokenDefaults.USDnr,
    address: USDNR_TOKEN_ADDRESS,
  },
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.USDC,
  fluentTestnetTokenDefaults.USDT,
];

export type FluentWidgetSession = {
  clientId: string;
  idToken: string;
  user: {
    id: string;
    email?: string;
  };
  wallet: {
    signerAddress?: `0x${string}`;
    smartAccountAddress?: `0x${string}`;
  };
  scopes: string[];
  issuedAt: number;
  expiresAt?: number;
  metadata?: Record<string, string>;
};
