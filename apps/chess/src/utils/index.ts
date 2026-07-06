import { FLUENT_TESTNET_CHAIN } from "../fluentSdk";

export function explorerAddress(address: string): string {
  return `${FLUENT_TESTNET_CHAIN.blockExplorers?.default.url}/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `${FLUENT_TESTNET_CHAIN.blockExplorers?.default.url}/tx/${hash}`;
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function parseChessBoard(fen: string) {
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
