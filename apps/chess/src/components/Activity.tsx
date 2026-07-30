import { explorerTx, formatAddress } from "../utils";
import type { ChessActivityRow } from "./types";

export function Activity({ rows }: { rows: ChessActivityRow[] }) {
  return (
    <div className="chess-activity">
      <div className="chess-activity-header">
        <strong>White</strong>
        <strong>Black</strong>
      </div>
      <div className="chess-activity-list">
        {rows.length ? rows.map((row, index) => (
          <div
            className="chess-activity-row"
            key={`${row.white?.txHash ?? "white"}-${row.black?.txHash ?? "black"}-${index}`}
          >
            {row.white?.txHash ? (
              <a href={explorerTx(row.white.txHash)} rel="noreferrer" target="_blank">
                <strong>{row.white.moveUci}</strong>
                <small>{formatAddress(row.white.txHash)}</small>
              </a>
            ) : (
              <span>-</span>
            )}
            {row.black?.txHash ? (
              <a href={explorerTx(row.black.txHash)} rel="noreferrer" target="_blank">
                <strong>{row.black.moveUci}</strong>
                <small>{formatAddress(row.black.txHash)}</small>
              </a>
            ) : (
              <span>-</span>
            )}
          </div>
        )) : (
          <div className="chess-activity-row">
            <span>-</span>
            <span>-</span>
          </div>
        )}
      </div>
    </div>
  );
}
