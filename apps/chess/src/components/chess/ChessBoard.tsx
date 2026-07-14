export function ChessBoard({
  board,
  chessPieces,
  selectedSquare,
  legalTargetSquares,
  playMode,
  manualBusy,
  onSquareClick,
}: {
  board: string[];
  chessPieces: Record<string, string>;
  selectedSquare: string | null;
  legalTargetSquares: Set<string>;
  playMode: "bot" | "manual";
  manualBusy: boolean;
  onSquareClick: (square: string, piece: string) => void;
}) {
  return (
    <div className="chess-board" aria-label="Chess board">
      {board.map((piece, index) => {
        const file = index % 8;
        const rank = Math.floor(index / 8);
        const dark = (file + rank) % 2 === 1;
        const square = `${String.fromCharCode(97 + file)}${8 - rank}`;
        const selected = selectedSquare === square;
        const legalTarget = legalTargetSquares.has(square);
        return (
          <button
            aria-label={`${square}${piece ? ` ${piece}` : ""}`}
            className={[
              dark ? "chess-square chess-square-dark" : "chess-square",
              selected ? "chess-square-selected" : "",
              legalTarget ? "chess-square-target" : "",
            ].filter(Boolean).join(" ")}
            disabled={playMode !== "manual" || manualBusy}
            key={`${index}-${piece || "empty"}`}
            onClick={() => onSquareClick(square, piece)}
            type="button"
          >
            {piece ? chessPieces[piece] : ""}
          </button>
        );
      })}
    </div>
  );
}
