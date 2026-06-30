import { useState, useCallback, useEffect } from "react";
import { FluentWidgetSession, CHESS_CONTRACT_ADDRESS, blendPublicClient, chessAbi, CHESS_GAME_ID, BLEND_TOKEN_ADDRESS, CHESS_MOVE_PRICE, CHESS_OPERATOR_ADDRESS, CHESS_FROM_BLOCK, chessPieces } from "../const";
import { ReownWalletState } from "../reown-appkit";
import { formatAddress } from "../utils/formatAddress";
import { parseChessBoard } from "../utils/parseChessBoard";
import { erc20Abi, parseUnits } from "viem";
import { fluentTestnet } from "viem/chains";

export function ChessDemo({
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
  const [setupStatus, setSetupStatus] = useState("Pending");
  const [botLevel, setBotLevel] = useState<"easy" | "medium" | "hard">("medium");
  const [playMode, setPlayMode] = useState<"bot" | "manual">("bot");
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
    refreshChess();
    const timer = setInterval(() => refreshChess(), 1800);
    return () => clearInterval(timer);
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

  const approveBotMode = useCallback(async () => {
    setPlayMode("bot");
    if (!gameCreated) {
      setSetupStatus("Create a game first");
      return;
    }
    if (!whiteAllowanceReady) {
      await approveBlend();
    }
    if (!whiteOperatorReady) {
      await approveOperator();
    }
    setSetupStatus("Bot mode ready. Grant the Fluent permission session from the widget menu.");
  }, [approveBlend, approveOperator, gameCreated, whiteAllowanceReady, whiteOperatorReady]);

  const playYourself = useCallback(() => {
    setPlayMode("manual");
    setSetupStatus("Manual mode selected");
  }, []);

  const copyBotConfig = useCallback(async () => {
    if (!CHESS_CONTRACT_ADDRESS) {
      setSetupStatus("Chess contract address is not configured");
      return;
    }
    const config = [
      `CHESS_CONTRACT_ADDRESS=${CHESS_CONTRACT_ADDRESS}`,
      "RPC_URL=https://rpc.testnet.fluent.xyz/",
      `GAME_ID=${CHESS_GAME_ID.toString()}`,
      `FROM_BLOCK=${CHESS_FROM_BLOCK.toString()}`,
      `BLEND_TOKEN_ADDRESS=${BLEND_TOKEN_ADDRESS}`,
      `BOT_LEVEL=${botLevel}`,
      "BOT_SIDE=auto",
      "AUTO_DISCOVER_GAMES=false",
      "BATCH_APPROVE_MOVE=true",
      "ZERO_DEV_PROJECT_ID=<zerodev-project-id>",
      "PERMISSION_ACCOUNT=<serialized-permission-account>",
      "PERMISSION_SMART_ACCOUNT=<smart-account-address>",
      "PRIVATE_KEY=<white-or-operator-private-key>",
    ].join("\n");
    await navigator.clipboard.writeText(config);
    setSetupStatus("Copied bot config template");
  }, [botLevel]);

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
          <button type="button" onClick={createGame} disabled={!canCreateGame || setupBusy}>
            {gameCreated ? "Game created" : setupBusy ? "Creating" : "Create game"}
          </button>
          <div className={`chess-bot-level chess-bot-level-${botLevel}`}>
            <span>Select bot level</span>
            <div className="chess-level-options" role="radiogroup" aria-label="Select bot level">
              {(["easy", "medium", "hard"] as const).map((level) => (
                <button
                  aria-checked={botLevel === level}
                  className={botLevel === level ? "active" : ""}
                  key={level}
                  onClick={() => setBotLevel(level)}
                  role="radio"
                  type="button"
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={approveBotMode} disabled={!gameCreated || setupBusy}>
            {whiteAllowanceReady && whiteOperatorReady ? "Bot approved" : "Approve bot"}
          </button>
          <button type="button" onClick={playYourself} disabled={!gameCreated || setupBusy}>
            Play yourself
          </button>
          <button type="button" onClick={copyBotConfig} disabled={!CHESS_CONTRACT_ADDRESS || setupBusy}>
            Copy bot config
          </button>
        </div>
        <p className="chess-session">
          Status: {setupBusy ? "pending" : gameCreated ? (whiteAllowanceReady && whiteOperatorReady ? "active session" : "created") : "pending"}
          {" · "}
          {playMode === "bot" ? `bot level ${botLevel}` : "manual play"}
          {" · "}
          {setupStatus === "Pending" && gameCreated && whiteAllowanceReady && whiteOperatorReady ? "Ready" : setupStatus}
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
