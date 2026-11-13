// @vitest-environment jsdom
/**
 * A manual chess move: which transaction `ChessDemo` sends for the player whose turn it is, and
 * through which wallet, as the game, the wallets and the publishing setting change.
 *
 * Fakes:
 * - `@privy-io/react-auth@2.25.0`, `@zerodev/ecdsa-validator@5.4.9` and `@zerodev/sdk@5.5.10`:
 *   the factories of `packages/connect/test/fakes/fluentId.ts`, a signed-in Fluent ID;
 * - `fetch`: the chess contract and BLEND token on Fluent testnet, as `viem@2.52.0` `http()`
 *   calls them (`../../test/chessChain.ts`);
 * - the host's `widget` and `wallet` props: `FluentBatchApi.createBatchOp` and an External
 *   wallet's `walletClient.writeContract`, each answering with a transaction hash.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { encodeFunctionData, type Hash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  privyModule,
  resetBoundary,
  SMART_ACCOUNT,
  zerodevSdkModule,
  zerodevValidatorModule,
} from "../../../../packages/connect/test/fakes/fluentId";
import {
  CHESS_CONTRACT,
  chain,
  CREATE_HASH,
  EXTERNAL_WALLET,
  resetChain,
  stubChain,
} from "../../test/chessChain";

vi.hoisted(() => {
  vi.stubEnv("VITE_CHESS_CONTRACT_ADDRESS", "0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0");
  vi.stubEnv("VITE_CHESS_BOT_PLAYER_ADDRESS", "0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0");
});

// The SDK resolves these from its own package, which the app does not depend on.
vi.mock("../../../../packages/connect/node_modules/@privy-io/react-auth", () => privyModule());
vi.mock(
  "../../../../packages/connect/node_modules/@zerodev/ecdsa-validator",
  async (importOriginal) => zerodevValidatorModule(await importOriginal()),
);
vi.mock("../../../../packages/connect/node_modules/@zerodev/sdk", async (importOriginal) =>
  zerodevSdkModule(await importOriginal()),
);

const { chessAbi } = await import("../contracts");
const { ChessDemo } = await import("./ChessDemo");
type ChessDemoProps = Parameters<typeof ChessDemo>[0];

const MOVE_HASH = `0x${"4d".repeat(32)}` as Hash;
const EXTERNAL_MOVE_HASH = `0x${"e7".repeat(32)}` as Hash;
const FEN_AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const FEN_AFTER_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

/** The host's Widget API: each Batch operation sends and answers with the next hash. */
function fakeWidget(hashes: Hash[] = [CREATE_HASH, MOVE_HASH]) {
  const execute = vi.fn();
  const createBatchOp = vi.fn((_op: unknown) => ({
    execute: async (options: unknown) => {
      execute(options);
      return { hash: hashes[Math.min(execute.mock.calls.length, hashes.length) - 1] };
    },
  }));
  return { createBatchOp, execute, signMessage: vi.fn() };
}

function fakeWallet() {
  const writeContract = vi.fn(async () => EXTERNAL_MOVE_HASH);
  return {
    writeContract,
    wallet: {
      configured: true,
      connected: true,
      address: EXTERNAL_WALLET,
      chainId: 20994,
      walletClient: { writeContract },
      switchChain: vi.fn(),
    },
  };
}

const SESSION = { account: { address: SMART_ACCOUNT, type: "smart" as const }, issuedAt: 1 };

function propsWith(overrides: Partial<Record<keyof ChessDemoProps, unknown>>): ChessDemoProps {
  return {
    session: SESSION,
    wallet: null,
    widget: fakeWidget(),
    onConnect: vi.fn(),
    ...overrides,
  } as ChessDemoProps;
}

function renderDemo(initial: ChessDemoProps) {
  const view = render(
    <StrictMode>
      <ChessDemo {...initial} />
    </StrictMode>,
  );
  return (next: ChessDemoProps) =>
    view.rerender(
      <StrictMode>
        <ChessDemo {...next} />
      </StrictMode>,
    );
}

/** Opens the New Game setup, picks manual play and the publishing, and creates the game. */
async function createManualGame(publishing: "Batch approve + move" | "Single tx") {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New Game" })).not.toHaveProperty("disabled", true),
  );
  fireEvent.click(screen.getByRole("button", { name: "New Game" }));
  fireEvent.click(screen.getByRole("button", { name: "Play yourself" }));
  fireEvent.click(screen.getByRole("button", { name: publishing }));
  fireEvent.click(screen.getByRole("button", { name: "Create Game" }));
  await screen.findByText(/Manual play is ready/, {}, { timeout: 5000 });
}

/** The next chain poll: the board and allowances are read again on a 1.8-second interval. */
async function nextPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1800);
  });
}

function clickSquare(square: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${square}( |$)`) }));
}

async function move(from: string, to: string) {
  await screen.findByRole("button", { name: new RegExp(`^${from} `) });
  clickSquare(from);
  clickSquare(to);
}

function submitMoveData(moveUci: string, fenAfterMove: string) {
  return encodeFunctionData({
    abi: chessAbi,
    functionName: "submitMove",
    args: [1n, moveUci, fenAfterMove],
  });
}

function status() {
  return screen.getByText(/^Status:/).textContent ?? "";
}

beforeEach(() => {
  // Only the polls are faked: the chain and the smart account answer in real time.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  window.localStorage.clear();
  resetBoundary();
  resetChain();
  stubChain();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ChessDemo's manual move", () => {
  it("sends one approve and move batch through the widget on the Fluent ID's turn, and nothing more on an unrelated render", async () => {
    const props = propsWith({});
    const rerender = renderDemo(props);
    await createManualGame("Batch approve + move");
    const { createBatchOp, execute } = props.widget as unknown as ReturnType<typeof fakeWidget>;
    expect(createBatchOp).toHaveBeenCalledTimes(1);

    await move("e2", "e4");
    await waitFor(() => expect(status()).toContain("Move e2e4 submitted"));

    expect(createBatchOp).toHaveBeenCalledTimes(2);
    expect(createBatchOp.mock.calls[1]).toEqual([
      {
        reviewTitle: "Batch approve + move",
        calls: [
          expect.objectContaining({ id: "approve-blend", method: "approve" }),
          {
            id: "submit-move",
            label: "Submit chess move",
            to: CHESS_CONTRACT,
            data: submitMoveData("e2e4", FEN_AFTER_E4),
          },
        ],
      },
    ]);
    expect(execute).toHaveBeenLastCalledWith({
      gasPayment: { symbol: "BLEND", includeApproval: true, approveAmount: 100n * 10n ** 18n },
    });
    // Pins current behaviour: the refresh after the move takes the last transaction from the chain's move events, so the move's own hash is gone while the chain lists none.
    expect(screen.queryByText(/^UserOp\/tx/)).toBeNull();

    rerender({ ...props });
    await nextPoll();

    expect(createBatchOp).toHaveBeenCalledTimes(2);
  });

  it("sends the move alone with Single tx, gated on the black side's allowance while the Fluent ID plays white", async () => {
    chain.allowances.set(SMART_ACCOUNT.toLowerCase(), 0n);
    const props = propsWith({});
    renderDemo(props);
    await createManualGame("Single tx");
    const { createBatchOp } = props.widget as unknown as ReturnType<typeof fakeWidget>;

    await move("e2", "e4");
    await waitFor(() => expect(status()).toContain("Move e2e4 submitted"));

    // Pins current behaviour: the Fluent ID's single move checks the black side's allowance flag, which is set because black is the bot, so white's empty allowance stops nothing.
    expect(createBatchOp).toHaveBeenCalledTimes(2);
    expect(createBatchOp.mock.calls[1]).toEqual([
      { calls: [{ to: CHESS_CONTRACT, data: submitMoveData("e2e4", FEN_AFTER_E4) }] },
    ]);
  });

  it("sends the move through the widget of the latest render", async () => {
    const first = fakeWidget();
    const second = fakeWidget([MOVE_HASH]);
    const props = propsWith({ widget: first });
    const rerender = renderDemo(props);
    await createManualGame("Batch approve + move");

    rerender({ ...props, widget: second as unknown as ChessDemoProps["widget"] });
    await move("e2", "e4");
    await waitFor(() => expect(status()).toContain("Move e2e4 submitted"));

    expect(first.createBatchOp).toHaveBeenCalledTimes(1);
    expect(second.createBatchOp).toHaveBeenCalledTimes(1);
    expect(second.createBatchOp.mock.calls[0][0]).toMatchObject({
      reviewTitle: "Batch approve + move",
    });
  });

  it("leaves the External wallet's turn to it once the wallet is passed, and sends it when its allowance is in", async () => {
    chain.white = EXTERNAL_WALLET;
    chain.black = SMART_ACCOUNT;
    chain.turn = EXTERNAL_WALLET;
    chain.allowances.set(EXTERNAL_WALLET.toLowerCase(), 0n);
    const props = propsWith({});
    const rerender = renderDemo(props);
    await createManualGame("Batch approve + move");
    const { createBatchOp } = props.widget as unknown as ReturnType<typeof fakeWidget>;

    await move("e2", "e4");
    await waitFor(() => expect(status()).toContain("This turn belongs to the other player"));

    const { wallet, writeContract } = fakeWallet();
    rerender({ ...props, wallet: wallet as unknown as ChessDemoProps["wallet"] });
    // Pins current behaviour: a refused move leaves its square selected, so one click on the target tries the same move again.
    expect(screen.getByRole("button", { name: "e2 P" }).className).toContain(
      "chess-square-selected",
    );
    clickSquare("e4");
    await waitFor(() =>
      expect(status()).toContain("Approve BLEND before submitting a manual move"),
    );
    expect(writeContract).not.toHaveBeenCalled();

    chain.allowances.set(EXTERNAL_WALLET.toLowerCase(), 10n ** 18n);
    await nextPoll();
    clickSquare("e4");
    await waitFor(() => expect(status()).toContain("Move e2e4 submitted"));

    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        account: EXTERNAL_WALLET,
        address: CHESS_CONTRACT,
        functionName: "submitMove",
        args: [1n, "e2e4", FEN_AFTER_E4],
      }),
    );
    expect(chain.receiptRequests).toContain(EXTERNAL_MOVE_HASH);
    expect(createBatchOp).toHaveBeenCalledTimes(1);
  });

  it("asks for the Fluent ID's allowance on its black turn and sends once the allowance is in", async () => {
    chain.white = EXTERNAL_WALLET;
    chain.black = SMART_ACCOUNT;
    chain.turn = SMART_ACCOUNT;
    chain.moves = [{ moveNumber: 1n, player: EXTERNAL_WALLET, moveUci: "e2e4", fen: FEN_AFTER_E4 }];
    chain.allowances.set(SMART_ACCOUNT.toLowerCase(), 0n);
    const props = propsWith({});
    renderDemo(props);
    await createManualGame("Single tx");
    await nextPoll();
    const { createBatchOp } = props.widget as unknown as ReturnType<typeof fakeWidget>;

    await move("e7", "e5");
    await waitFor(() =>
      expect(status()).toContain("Approve Fluent BLEND before submitting a manual move"),
    );
    expect(createBatchOp).toHaveBeenCalledTimes(1);

    chain.allowances.set(SMART_ACCOUNT.toLowerCase(), 10n ** 18n);
    await nextPoll();
    clickSquare("e5");
    await waitFor(() => expect(status()).toContain("Move e7e5 submitted"));

    expect(createBatchOp).toHaveBeenCalledTimes(2);
    expect(createBatchOp.mock.calls[1]).toEqual([
      { calls: [{ to: CHESS_CONTRACT, data: submitMoveData("e7e5", FEN_AFTER_E5) }] },
    ]);
  });
});
