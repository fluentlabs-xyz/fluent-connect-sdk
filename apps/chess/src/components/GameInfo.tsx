import { explorerAddress, formatAddress } from "../utils";
import type { ChessBotLevel, ChessGameMeta, ChessPlayMode } from "./types";

export function GameInfo({
  activeGameId,
  batchPublishing,
  botLevel,
  gameMeta,
  gamePaused,
  playMode,
}: {
  activeGameId: bigint;
  batchPublishing: boolean;
  botLevel: ChessBotLevel;
  gameMeta: ChessGameMeta;
  gamePaused: boolean;
  playMode: ChessPlayMode;
}) {
  return (
    <details className="chess-game-info">
      <summary>Game Info</summary>
      <div className="chess-game-info-grid">
        <span>State</span>
        <strong>{gameMeta.active ? (gamePaused ? "Paused" : "Active") : "Inactive"}</strong>
        <span>Game #</span>
        <strong>{activeGameId.toString()}</strong>
        <span>Moves</span>
        <strong>{gameMeta.moveCount?.toString() ?? "0"}</strong>
        <span>Bot level</span>
        <strong>{botLevel}</strong>
        <span>Mode</span>
        <strong>{playMode === "bot" ? "Auto play" : "Play yourself"}</strong>
        <span>Publishing</span>
        <strong>{batchPublishing ? "Batch approve + move" : "Single tx"}</strong>
        <span>White</span>
        {gameMeta.white ? (
          <a href={explorerAddress(gameMeta.white)} target="_blank" rel="noreferrer">
            {formatAddress(gameMeta.white)}
          </a>
        ) : (
          <strong>-</strong>
        )}
        <span>Black</span>
        {gameMeta.black ? (
          <a href={explorerAddress(gameMeta.black)} target="_blank" rel="noreferrer">
            {formatAddress(gameMeta.black)}
          </a>
        ) : (
          <strong>-</strong>
        )}
      </div>
    </details>
  );
}
