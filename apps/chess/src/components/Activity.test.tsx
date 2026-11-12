// @vitest-environment jsdom
/**
 * The chess activity list: what each move row shows and which row survives a new list.
 * No fakes: the list is rendered from props.
 */
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import type { Hash } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

// The app's constants read the chess contract at import; the explorer links import them.
vi.hoisted(() => {
  vi.stubEnv("VITE_CHESS_CONTRACT_ADDRESS", "0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0");
});

import { Activity } from "./Activity";
import type { ChessActivityRow } from "./types";

const hash = (byte: string) => `0x${byte.repeat(32)}` as Hash;

const ROW_1: ChessActivityRow = {
  white: { moveNumber: 1n, moveUci: "e2e4", txHash: hash("11") },
  black: { moveNumber: 2n, moveUci: "e7e5", txHash: hash("22") },
};
const ROW_2: ChessActivityRow = {
  white: { moveNumber: 3n, moveUci: "g1f3", txHash: hash("33") },
};
const ROW_2_ANSWERED: ChessActivityRow = {
  ...ROW_2,
  black: { moveNumber: 4n, moveUci: "b8c6", txHash: hash("44") },
};
const ROW_3: ChessActivityRow = {
  white: { moveNumber: 5n, moveUci: "f1c4", txHash: hash("55") },
};

function renderActivity(rows: ChessActivityRow[]) {
  const view = render(
    <StrictMode>
      <Activity rows={rows} />
    </StrictMode>,
  );
  const listRows = () =>
    Array.from(view.container.querySelectorAll(".chess-activity-list > .chess-activity-row"));
  return {
    listRows,
    rerender: (next: ChessActivityRow[]) =>
      view.rerender(
        <StrictMode>
          <Activity rows={next} />
        </StrictMode>,
      ),
  };
}

afterEach(cleanup);

describe("Activity", () => {
  it("draws one row of dashes when no move is listed", () => {
    const { listRows } = renderActivity([]);

    expect(listRows()).toHaveLength(1);
    expect(listRows()[0].textContent).toBe("--");
  });

  it("draws each row's moves as explorer links, and a dash for a missing side", () => {
    const { listRows } = renderActivity([ROW_2, ROW_1]);

    expect(listRows().map((row) => row.textContent)).toEqual([
      "g1f30x3333...3333-",
      "e2e40x1111...1111e7e50x2222...2222",
    ]);
    const links = listRows()[1].querySelectorAll("a");
    expect(links[0].getAttribute("href")).toContain(hash("11"));
    expect(links[1].getAttribute("href")).toContain(hash("22"));
  });

  it("keeps every row's element through an unrelated render", () => {
    const rows = [ROW_2, ROW_1];
    const { listRows, rerender } = renderActivity(rows);
    const before = listRows();

    rerender([...rows]);

    expect(listRows()).toEqual(before);
    expect(listRows().every((row, index) => row === before[index])).toBe(true);
  });

  it("keeps the rows that stay at their index when the last row goes", () => {
    const { listRows, rerender } = renderActivity([ROW_2, ROW_1]);
    const [first] = listRows();

    rerender([ROW_2]);

    expect(listRows()).toHaveLength(1);
    expect(listRows()[0]).toBe(first);
  });

  it("keeps the rows that move down one place when a new row arrives at the front", () => {
    const { listRows, rerender } = renderActivity([ROW_2, ROW_1]);
    const [second, first] = listRows();

    rerender([ROW_3, ROW_2, ROW_1]);

    expect(listRows().map((row) => row.textContent?.slice(0, 4))).toEqual(["f1c4", "g1f3", "e2e4"]);
    // A row is keyed by its moves, not its place, so a row that only moved keeps its element.
    expect(listRows()[1]).toBe(second);
    expect(listRows()[2]).toBe(first);
  });

  it("moves each row's element when the rows are reordered", () => {
    const { listRows, rerender } = renderActivity([ROW_2, ROW_1]);
    const [second, first] = listRows();

    rerender([ROW_1, ROW_2]);

    expect(listRows()[0]).toBe(first);
    expect(listRows()[1]).toBe(second);
  });

  it("keeps a row's element when its black move arrives", () => {
    const { listRows, rerender } = renderActivity([ROW_2, ROW_1]);
    const [second, first] = listRows();

    rerender([ROW_2_ANSWERED, ROW_1]);

    expect(listRows()[0].textContent).toBe("g1f30x3333...3333b8c60x4444...4444");
    // The white move names the row, so the black move that answers it fills the same element.
    expect(listRows()[0]).toBe(second);
    expect(listRows()[1]).toBe(first);
  });
});
