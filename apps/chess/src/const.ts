import { fluentTestnet, fluentTestnetTokenDefaults, type FluentTokenDefinition } from "@fluent/wallet-sdk";
import { createPublicClient, http, parseUnits } from "viem";

export const BLEND_TOKEN_ADDRESS = fluentTestnetTokenDefaults.BLEND.address;
export const CHESS_CONTRACT_ADDRESS = import.meta.env.VITE_CHESS_CONTRACT_ADDRESS as `0x${string}`;
export const CHESS_GAME_ID = BigInt(import.meta.env.VITE_CHESS_GAME_ID ?? "1");
export const CHESS_FROM_BLOCK = BigInt(import.meta.env.VITE_CHESS_FROM_BLOCK ?? "0");
export const CHESS_TREASURY_ADDRESS = (import.meta.env.VITE_CHESS_TREASURY_ADDRESS ||
  "0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E") as `0x${string}`;
export const CHESS_BOT_PLAYER_ADDRESS = import.meta.env.VITE_CHESS_BOT_PLAYER_ADDRESS as
  | `0x${string}`
  | undefined;
export const CHESS_MOVE_PRICE = parseUnits("1", 18);
export const CHESS_BOT_CONTROL_ENDPOINT =
  import.meta.env.VITE_CHESS_BOT_CONTROL_ENDPOINT ?? "/chess-bot";
export const CHESS_BOT_SESSION_STORAGE_KEY = `fluent:chess:zerodev-session:v4:${CHESS_CONTRACT_ADDRESS.toLowerCase()}`;
export const BLEND_PAYMENT_RECIPIENT = (import.meta.env.VITE_BLEND_PAY_RECIPIENT ||
  "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4") as `0x${string}`;
export const USDNR_TOKEN_ADDRESS = import.meta.env.VITE_USDNR_TOKEN_ADDRESS as
  | `0x${string}`
  | undefined;

export const blendPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(),
});

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

export const chessDemoTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.ETH,
  {
    ...fluentTestnetTokenDefaults.USDnr,
    address: USDNR_TOKEN_ADDRESS,
  },
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.USDC,
  fluentTestnetTokenDefaults.USDT,
];
