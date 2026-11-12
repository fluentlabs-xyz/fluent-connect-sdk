// @vitest-environment jsdom
/**
 * The chess board's 64 squares: what each button shows and which button survives a new board.
 * No fakes: the board is rendered from props.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseChessBoard } from "../utils/parseChessBoard";
import { Board } from "./Board";

const START = parseChessBoard("start");
const AFTER_E4 = parseChessBoard("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");

type BoardProps = Parameters<typeof Board>[0];

/** The glyphs of the white and black pawns and rooks, the only pieces these cases read. */
const chessPieces: Record<string, string> = { P: "♙", p: "♟", R: "♖", r: "♜", n: "♞" };

function props(overrides: Partial<BoardProps> = {}): BoardProps {
  return {
    board: START,
    chessPieces,
    selectedSquare: null,
    legalTargetSquares: new Set<string>(),
    playMode: "manual",
    manualBusy: false,
    onSquareClick: vi.fn(),
    ...overrides,
  };
}

function renderBoard(initial: BoardProps) {
  const view = render(
    <StrictMode>
      <Board {...initial} />
    </StrictMode>,
  );
  return {
    rerender: (next: BoardProps) =>
      view.rerender(
        <StrictMode>
          <Board {...next} />
        </StrictMode>,
      ),
  };
}

function square(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

afterEach(cleanup);

describe("Board", () => {
  it("draws 64 squares from a8 to h1 with each piece's glyph", () => {
    renderBoard(props());

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(64);
    expect(buttons[0].getAttribute("aria-label")).toBe("a8 r");
    expect(buttons[63].getAttribute("aria-label")).toBe("h1 R");
    expect(square("e2 P").textContent).toBe("♙");
    expect(square("e4").textContent).toBe("");
    expect(square("a8 r").className).toBe("chess-square");
    expect(square("b8 n").className).toBe("chess-square chess-square-dark");
  });

  it("calls onSquareClick once per click with the square and its piece", () => {
    const onSquareClick = vi.fn();
    renderBoard(props({ onSquareClick }));

    fireEvent.click(square("e2 P"));
    fireEvent.click(square("e4"));

    expect(onSquareClick.mock.calls).toEqual([
      ["e2", "P"],
      ["e4", ""],
    ]);
  });

  it("keeps every square's button through an unrelated render", () => {
    const initial = props();
    const { rerender } = renderBoard(initial);
    const before = screen.getAllByRole("button");

    rerender({ ...initial, onSquareClick: vi.fn() });

    const after = screen.getAllByRole("button");
    expect(after.every((button, index) => button === before[index])).toBe(true);
  });

  it("keeps every square's button when the board changes", () => {
    const initial = props();
    const { rerender } = renderBoard(initial);
    const e2 = square("e2 P");
    const e4 = square("e4");
    const a8 = square("a8 r");
    const d2 = square("d2 P");
    const before = screen.getAllByRole("button");

    rerender({ ...initial, board: AFTER_E4 });

    const after = screen.getAllByRole("button");
    expect(after).toHaveLength(64);
    expect(after.every((button, index) => button === before[index])).toBe(true);

    // A button is keyed by its square, so a move changes what two buttons show, not which buttons exist.
    expect(square("e2")).toBe(e2);
    expect(square("e4 P")).toBe(e4);
    expect(square("a8 r")).toBe(a8);
    expect(square("d2 P")).toBe(d2);
  });

  it("marks the selected square and the legal targets, keeping their buttons", () => {
    const initial = props();
    const { rerender } = renderBoard(initial);
    const e2 = square("e2 P");
    const e3 = square("e3");

    rerender({ ...initial, selectedSquare: "e2" });
    expect(square("e2 P")).toBe(e2);
    expect(square("e2 P").className).toContain("chess-square-selected");

    rerender({ ...initial, selectedSquare: "e2", legalTargetSquares: new Set(["e3", "e4"]) });
    expect(square("e3")).toBe(e3);
    expect(square("e3").className).toContain("chess-square-target");
    expect(square("e4").className).toContain("chess-square-target");
    expect(square("e5").className).not.toContain("chess-square-target");
  });

  it("disables every square outside manual play or while a manual move is out", () => {
    const initial = props();
    const { rerender } = renderBoard(initial);
    expect((square("e2 P") as HTMLButtonElement).disabled).toBe(false);

    rerender({ ...initial, playMode: "bot" });
    expect(screen.getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(
      true,
    );

    rerender({ ...initial, manualBusy: true });
    expect(screen.getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(
      true,
    );
  });
});
