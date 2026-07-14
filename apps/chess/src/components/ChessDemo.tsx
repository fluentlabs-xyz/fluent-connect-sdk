import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Chess, type Move, type Square } from "chess.js";
import {
  approveBlendWithExternalWallet,
  approveBlendWithFluentAccount,
  createChessGameData,
  createChessMoveData,
  getFluentAccountAddress,
  getStoredFluentSession,
  grantChessBotPermission,
  prepareFluentAccount,
  sendFluentAccountTransaction,
  submitApproveAndMoveBatch,
  submitChessMoveWithExternalWallet,
  useChessFluentAccount,
  type ChessExternalWalletState,
  type ChessFluentBatchApi,
  type ChessFluentWidgetSession,
} from "../fluentSdk";
import { CHESS_CONTRACT_ADDRESS, blendPublicClient, CHESS_GAME_ID, BLEND_TOKEN_ADDRESS, CHESS_MOVE_PRICE, CHESS_FROM_BLOCK, chessPieces, CHESS_BOT_CONTROL_ENDPOINT, CHESS_BOT_SESSION_STORAGE_KEY, CHESS_BOT_PLAYER_ADDRESS, CHESS_BOT_MAX_PERMISSIONED_MOVES } from "../const";
import { CHESS_ACTIVE_GAME_STORAGE_KEY, CHESS_EVENT_LOOKBACK_BLOCKS, CHESS_PAUSED_GAMES_STORAGE_KEY } from "../chess/constants";
import { chessAbi, erc20Abi } from "../contracts/abis";
import { formatAddress, parseChessBoard } from "../utils";
import { ChessActivity } from "./chess/ChessActivity";
import { ChessBoard } from "./chess/ChessBoard";
import { ChessGameInfo } from "./chess/ChessGameInfo";
import { ChessSetupControls } from "./chess/ChessSetupControls";
import type { ChessActivityItem, ChessActivityRow, ChessBotLevel, ChessGameMeta, ChessPermissionSession, ChessPlayMode } from "./chess/types";
import { type Address, type Hash } from "viem";

const chessContractStorageSuffix = CHESS_CONTRACT_ADDRESS.toLowerCase();
const chessActiveGameStorageKey = `${CHESS_ACTIVE_GAME_STORAGE_KEY}:${chessContractStorageSuffix}`;
const chessPausedGamesStorageKey = `${CHESS_PAUSED_GAMES_STORAGE_KEY}:${chessContractStorageSuffix}`;

export function ChessDemo({
  session,
  wallet,
  widget,
  onConnect,
}: {
  session: ChessFluentWidgetSession | null;
  wallet: ChessExternalWalletState | null;
  widget: ChessFluentBatchApi;
  onConnect: () => void;
}) {
  ////////// ////////// ////////// ////////// ////////// //////////
  ////////// 1. Load Fluent Account: the widget session gives us the user.
  ////////// ZeroDev derives the user-facing smart account used by the chess app.
  const smartAccount = useChessFluentAccount();
  const [fen, setFen] = useState("start");
  const [lastMove, setLastMove] = useState("Waiting for first move");
  const [lastTxHash, setLastTxHash] = useState<Hash | null>(null);
  const [status, setStatus] = useState(
    CHESS_CONTRACT_ADDRESS ? "Watching Fluent Testnet" : "Deploy chess contract to enable live mode",
  );
  const [setupStatus, setSetupStatus] = useState("Pending");
  const [botLevel, setBotLevel] = useState<ChessBotLevel>("medium");
  const [playMode, setPlayMode] = useState<ChessPlayMode>("bot");
  const [batchPublishing, setBatchPublishing] = useState(true);
  const [creatingNewGame, setCreatingNewGame] = useState(false);
  const [draftBotLevel, setDraftBotLevel] = useState<ChessBotLevel>("medium");
  const [draftPlayMode, setDraftPlayMode] = useState<ChessPlayMode>("bot");
  const [draftBatchPublishing, setDraftBatchPublishing] = useState(true);
  const [pausedGames, setPausedGames] = useState<Set<string>>(() => {
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 2. Restore Chess State: keep game controls stable across page reloads.
    try {
      const raw = window.localStorage.getItem(chessPausedGamesStorageKey);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const [activeGameId, setActiveGameId] = useState<bigint>(() => {
    try {
      const stored = window.localStorage.getItem(chessActiveGameStorageKey);
      return stored ? BigInt(stored) : CHESS_GAME_ID;
    } catch {
      return CHESS_GAME_ID;
    }
  });
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [pendingAutoPrepareGameId, setPendingAutoPrepareGameId] = useState<bigint | null>(null);
  const [watchFromBlock, setWatchFromBlock] = useState<bigint | null>(null);
  const [whiteAllowanceReady, setWhiteAllowanceReady] = useState(false);
  const [blackAllowanceReady, setBlackAllowanceReady] = useState(false);
  const [permissionSession, setPermissionSession] = useState<ChessPermissionSession | null>(() => {
    try {
      const raw = window.localStorage.getItem(CHESS_BOT_SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [botSessionReady, setBotSessionReady] = useState(false);
  const registeredBotSessionKey = useRef<string | null>(null);
  const [gameMeta, setGameMeta] = useState<ChessGameMeta>({});
  const [activity, setActivity] = useState<ChessActivityItem[]>([]);
  const fallbackSession = useMemo(() => {
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 3. Read Existing Session: chess can be opened directly at /chess.
    if (session) return session;
    return getStoredFluentSession();
  }, [session]);

  useEffect(() => {
    console.log("[chess session] state", {
      hasPropSession: Boolean(session),
      hasFallbackSession: Boolean(fallbackSession),
      userId: fallbackSession?.user?.id,
      signerAddress: fallbackSession?.wallet?.signerAddress,
      storedSmartAccountAddress: fallbackSession?.wallet?.smartAccountAddress,
      smartAccountReady: smartAccount.smartAccountReady,
      smartAccountAddress: smartAccount.smartAccountAddress,
      signerAddressFromPrivy: smartAccount.signerAddress,
      privyReady: smartAccount.privyReady,
      privyAuthenticated: smartAccount.privyAuthenticated,
      embeddedWalletCount: smartAccount.embeddedWalletCount,
      error: smartAccount.error?.message,
    });
  }, [
    fallbackSession,
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.error?.message,
    smartAccount.privyAuthenticated,
    smartAccount.privyReady,
    smartAccount.signerAddress,
    smartAccount.smartAccountAddress,
    smartAccount.smartAccountReady,
  ]);

  const resetGameView = useCallback((gameId: bigint, fromBlock: bigint | null = null) => {
    window.localStorage.setItem(chessActiveGameStorageKey, gameId.toString());
    setActiveGameId(gameId);
    setFen("start");
    setActivity([]);
    setLastMove("Waiting for first move");
    setLastTxHash(null);
    setWatchFromBlock(fromBlock);
    setGameMeta({});
    setWhiteAllowanceReady(false);
    setBlackAllowanceReady(false);
    setBotSessionReady(false);
    registeredBotSessionKey.current = null;
  }, []);

  useEffect(() => {
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 4. Discover Latest Game: demo follows the newest on-chain game.
    if (!CHESS_CONTRACT_ADDRESS) return;
    const chessContractAddress = CHESS_CONTRACT_ADDRESS;
    let cancelled = false;

    async function syncLatestGame() {
      try {
        const nextGameId = await blendPublicClient.readContract({
          address: chessContractAddress,
          abi: chessAbi,
          functionName: "nextGameId",
        });
        if (cancelled) return;
        if (nextGameId <= 1n) {
          if (activeGameId !== CHESS_GAME_ID) {
            resetGameView(CHESS_GAME_ID, null);
          }
          return;
        }

        const latestGameId = nextGameId - 1n;
        if (latestGameId <= activeGameId) return;

        const latestBlock = await blendPublicClient.getBlockNumber();
        const fromBlock =
          latestBlock > CHESS_EVENT_LOOKBACK_BLOCKS
            ? latestBlock - CHESS_EVENT_LOOKBACK_BLOCKS
            : CHESS_FROM_BLOCK;
        resetGameView(latestGameId, fromBlock);
        setSetupStatus(`Switched to latest game #${latestGameId.toString()}`);
      } catch {
        // Keep the demo usable if the RPC cannot read the latest game counter.
      }
    }

    void syncLatestGame();
    const timer = setInterval(syncLatestGame, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeGameId, resetGameView]);

  const refreshChess = useCallback(async () => {
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 5. Read Chain State: game metadata, allowances, and moves.
    if (!CHESS_CONTRACT_ADDRESS) return;

    try {
      const game = await blendPublicClient.readContract({
        address: CHESS_CONTRACT_ADDRESS,
        abi: chessAbi,
        functionName: "games",
        args: [activeGameId],
      });
      const [white, black, turn, active, moveCount] = game;
      setGameMeta({ white, black, turn, active, moveCount });
      if (moveCount === 0n || activity.length === 0) {
        console.log("[chess poll] game state", {
          activeGameId: activeGameId.toString(),
          white,
          black,
          turn,
          active,
          moveCount: moveCount.toString(),
          watchFromBlock: watchFromBlock?.toString(),
        });
      }
      const gameCreated = white !== "0x0000000000000000000000000000000000000000";
      const whiteAccount = white as Address;
      const blackAccount = black as Address;
      const fluentAccount = smartAccount.smartAccountAddress ?? fallbackSession?.wallet.smartAccountAddress;
      if (gameCreated && CHESS_CONTRACT_ADDRESS) {
        const allowance = await blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [whiteAccount, CHESS_CONTRACT_ADDRESS],
        });
        setWhiteAllowanceReady(allowance >= CHESS_MOVE_PRICE);
      } else {
        setWhiteAllowanceReady(false);
      }
      if (
        gameCreated &&
        blackAccount &&
        fluentAccount &&
        blackAccount.toLowerCase() === fluentAccount.toLowerCase() &&
        CHESS_CONTRACT_ADDRESS
      ) {
        const allowance = await blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [blackAccount, CHESS_CONTRACT_ADDRESS],
        });
        setBlackAllowanceReady(allowance >= CHESS_MOVE_PRICE);
      } else {
        setBlackAllowanceReady(true);
      }
      const latestBlock = await blendPublicClient.getBlockNumber();
      const fromBlock =
        watchFromBlock ??
        (latestBlock > CHESS_EVENT_LOOKBACK_BLOCKS ? latestBlock - CHESS_EVENT_LOOKBACK_BLOCKS : CHESS_FROM_BLOCK);
      if (watchFromBlock === null) setWatchFromBlock(fromBlock);
      const events = await blendPublicClient.getContractEvents({
        address: CHESS_CONTRACT_ADDRESS,
        abi: chessAbi,
        eventName: "MoveSubmitted",
        args: { gameId: activeGameId },
        fromBlock,
        toBlock: "latest",
      });
      if (events.length === 0 && moveCount > 0n) {
        console.warn("[chess poll] no MoveSubmitted events found for non-zero move count", {
          activeGameId: activeGameId.toString(),
          moveCount: moveCount.toString(),
          fromBlock: fromBlock.toString(),
          toBlock: "latest",
        });
      }
      const sortedEvents = events
        .filter((event) => event.args.gameId === activeGameId)
        .sort((a, b) => Number((a.args.moveNumber ?? 0n) - (b.args.moveNumber ?? 0n)));
      const latest = sortedEvents
        .map((event) => event.args)
        .filter((args) => args.gameId === activeGameId)
        .at(-1);
      setActivity(
        sortedEvents.slice(-16).reverse().map((event) => ({
          moveNumber: event.args.moveNumber ?? 0n,
          moveUci: event.args.moveUci ?? "",
          player: event.args.player,
          txHash: event.transactionHash as Hash | undefined,
          blockNumber: event.blockNumber ?? undefined,
        })),
      );

      setFen(latest?.fenAfterMove || "start");
      setLastMove(
        latest?.moveUci
          ? `${latest.moveUci} by ${latest.player ? formatAddress(latest.player) : "player"}`
          : "Waiting for first move",
      );
      const latestEvent = sortedEvents.at(-1);
      setLastTxHash((latestEvent?.transactionHash ?? null) as Hash | null);
      setStatus(gameCreated ? (active ? "Live on Fluent Testnet" : "Game finished") : "Contract deployed; create game");
    } catch (error) {
      console.error("[chess poll] failed", {
        activeGameId: activeGameId.toString(),
        watchFromBlock: watchFromBlock?.toString(),
        error,
      });
      setStatus(error instanceof Error ? error.message : "Could not read chess game");
    }
  }, [activeGameId, activity.length, fallbackSession?.wallet.smartAccountAddress, smartAccount.smartAccountAddress, watchFromBlock]);

  useEffect(() => {
    refreshChess();
    const timer = setInterval(() => refreshChess(), 1800);
    return () => clearInterval(timer);
  }, [refreshChess]);

  const chess = useMemo(() => {
    try {
      return fen === "start" ? new Chess() : new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);
  const legalTargetSquares = useMemo(() => {
    if (!selectedSquare) return new Set<string>();
    return new Set(
      (chess.moves({ square: selectedSquare as Square, verbose: true }) as Move[]).map((move) => move.to),
    );
  }, [chess, selectedSquare]);
  const board = parseChessBoard(fen);
  const connected = getFluentAccountAddress(smartAccount, fallbackSession);
  const activeGameKey = activeGameId.toString();
  const gamePaused = pausedGames.has(activeGameKey);
  const turnSide = gameMeta.turn && gameMeta.white
    ? gameMeta.turn.toLowerCase() === gameMeta.white.toLowerCase()
      ? "white"
      : "black"
    : "white";
  const manualActor =
    gameMeta.turn && wallet?.address && gameMeta.turn.toLowerCase() === wallet.address.toLowerCase()
      ? "external"
      : gameMeta.turn && smartAccount.smartAccountAddress && gameMeta.turn.toLowerCase() === smartAccount.smartAccountAddress.toLowerCase()
        ? "fluent"
        : null;
  const gameCreated = Boolean(
    gameMeta.white && gameMeta.white !== "0x0000000000000000000000000000000000000000",
  );
  const gameOngoing = Boolean(gameCreated && gameMeta.active);
  const activityRows = useMemo(() => {
    const rows = new Map<string, {
      white?: typeof activity[number];
      black?: typeof activity[number];
    }>();
    for (const item of [...activity].reverse()) {
      const moveNumber = item.moveNumber > 0n ? item.moveNumber : 1n;
      const rowId = ((moveNumber - 1n) / 2n).toString();
      const current = rows.get(rowId) ?? {};
      const player = item.player?.toLowerCase();
      const white = gameMeta.white?.toLowerCase();
      const black = gameMeta.black?.toLowerCase();
      if (player && black && player === black) {
        current.black = item;
      } else if (player && white && player === white) {
        current.white = item;
      } else if (moveNumber % 2n === 0n) {
        current.black = item;
      } else {
        current.white = item;
      }
      rows.set(rowId, current);
    }
    return Array.from(rows.entries())
      .sort(([a], [b]) => Number(BigInt(b) - BigInt(a)))
      .map(([, row]) => row)
      .slice(0, 12);
  }, [activity, gameMeta.black, gameMeta.white]);
  const canCreateGame = Boolean(
    CHESS_CONTRACT_ADDRESS &&
      !setupBusy,
  );

  const createGame = useCallback(async (settings?: {
    botLevel: ChessBotLevel;
    playMode: ChessPlayMode;
    batchPublishing: boolean;
  }) => {
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 6. Create Game: user's Fluent ZeroDev account creates the game.
    ////////// No external deployer wallet is required for the builder-facing flow.
    const nextBotLevel = settings?.botLevel ?? botLevel;
    const nextPlayMode = settings?.playMode ?? playMode;
    const nextBatchPublishing = settings?.batchPublishing ?? batchPublishing;

    if (!CHESS_CONTRACT_ADDRESS) {
      setSetupStatus("Chess contract address is not configured");
      return false;
    }
    if (!fallbackSession && !connected) {
      console.log("[chess create] Fluent session missing; opening connect", {
        connected,
        hasFallbackSession: Boolean(fallbackSession),
      });
      setSetupStatus(
        "Connect Fluent ID first. The Fluent Account creates the game through ZeroDev.",
      );
      onConnect();
      return false;
    }
    setSetupBusy(true);
    try {
      console.log("[chess create] start", {
        connected,
        hasFallbackSession: Boolean(fallbackSession),
        botLevel: nextBotLevel,
        playMode: nextPlayMode,
        batchPublishing: nextBatchPublishing,
        privyReady: smartAccount.privyReady,
        privyAuthenticated: smartAccount.privyAuthenticated,
        embeddedWalletCount: smartAccount.embeddedWalletCount,
        signerAddress: smartAccount.signerAddress,
        smartAccountReady: smartAccount.smartAccountReady,
        smartAccountAddress: smartAccount.smartAccountAddress,
      });
      setSetupStatus("Preparing your Fluent ZeroDev account");
      const preparedKernel = await prepareFluentAccount(smartAccount);
      console.log("[chess create] ZeroDev account prepared", {
        smartAccountAddress: preparedKernel.smartAccountAddress,
        zeroDevRpcUrl: preparedKernel.zeroDevRpcUrl,
      });
      if (!CHESS_BOT_PLAYER_ADDRESS) {
        console.log("[chess create] missing bot player address");
        setSetupStatus("Configure VITE_CHESS_BOT_PLAYER_ADDRESS to create games");
        return false;
      }
      if (CHESS_BOT_PLAYER_ADDRESS.toLowerCase() === preparedKernel.smartAccountAddress.toLowerCase()) {
        console.log("[chess create] bot player equals smart account", {
          botPlayerAddress: CHESS_BOT_PLAYER_ADDRESS,
          smartAccountAddress: preparedKernel.smartAccountAddress,
        });
        setSetupStatus("Bot player address must differ from your Fluent account");
        return false;
      }
      setBotLevel(nextBotLevel);
      setPlayMode(nextPlayMode);
      setBatchPublishing(nextBatchPublishing);
      setSetupStatus("Creating game from your Fluent ZeroDev account");
      console.log("[chess create] submitting createGame", {
        chessContract: CHESS_CONTRACT_ADDRESS,
        botPlayerAddress: CHESS_BOT_PLAYER_ADDRESS,
      });
      const hash = await sendFluentAccountTransaction(smartAccount, {
        to: CHESS_CONTRACT_ADDRESS,
        data: createChessGameData(CHESS_BOT_PLAYER_ADDRESS),
      });
      console.log("[chess create] submitted", { hash });
      setSetupStatus(`Game creation submitted: ${formatAddress(hash)}`);
      const receipt = await blendPublicClient.waitForTransactionReceipt({ hash });
      console.log("[chess create] receipt", {
        hash,
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status,
      });
      const createdEvents = await blendPublicClient.getContractEvents({
        address: CHESS_CONTRACT_ADDRESS,
        abi: chessAbi,
        eventName: "GameCreated",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      const created = createdEvents.find((event) => event.transactionHash === hash);
      const nextGameId = created?.args.gameId;
      if (nextGameId === undefined) throw new Error("GameCreated event not found");
      resetGameView(nextGameId, receipt.blockNumber);
      setLastTxHash(hash);
      setSetupStatus(
        nextPlayMode === "bot"
          ? `New game #${nextGameId.toString()} created. Preparing auto play permissions.`
          : `New game #${nextGameId.toString()} created. Manual play is ready.`,
      );
      if (nextPlayMode === "bot") setPendingAutoPrepareGameId(nextGameId);
      await refreshChess();
      return true;
    } catch (error) {
      console.error("[chess create] failed", error);
      setSetupStatus(error instanceof Error ? error.message : "Could not create game");
      return false;
    } finally {
      setSetupBusy(false);
    }
  }, [batchPublishing, botLevel, connected, fallbackSession, onConnect, playMode, refreshChess, resetGameView, smartAccount]);

  const setGamePaused = useCallback(async (paused: boolean) => {
    setSetupBusy(true);
    try {
      const nextPausedGames = new Set(pausedGames);
      if (paused) {
        nextPausedGames.add(activeGameKey);
      } else {
        nextPausedGames.delete(activeGameKey);
      }
      setPausedGames(nextPausedGames);
      window.localStorage.setItem(
        chessPausedGamesStorageKey,
        JSON.stringify(Array.from(nextPausedGames)),
      );

      if (CHESS_BOT_CONTROL_ENDPOINT) {
        console.log("[chess bot] toggling pause", {
          endpoint: CHESS_BOT_CONTROL_ENDPOINT,
          activeGameKey,
          paused,
        });
        const response = await fetch(`${CHESS_BOT_CONTROL_ENDPOINT}/games/${activeGameKey}/${paused ? "pause" : "resume"}`, {
          method: "POST",
        });
        console.log("[chess bot] pause response", {
          status: response.status,
          ok: response.ok,
        });
      }

      setSetupStatus(paused ? `Game #${activeGameKey} paused` : `Game #${activeGameKey} resumed`);
    } catch (error) {
      const fallback = paused ? "Local pause saved, bot sync failed" : "Local resume saved, bot sync failed";
      setSetupStatus(
        error instanceof Error
          ? `${fallback}: ${error.message}`
          : fallback,
      );
    } finally {
      setSetupBusy(false);
    }
  }, [activeGameKey, pausedGames]);

  const approveBlend = useCallback(async () => {
    if (!CHESS_CONTRACT_ADDRESS) return;
    setSetupBusy(true);
    try {
      const fluentAccount = smartAccount.smartAccountAddress;
      const whiteAccount = gameMeta.white as Address | undefined;
      let hash: Hash;
      if (whiteAccount && fluentAccount && whiteAccount.toLowerCase() === fluentAccount.toLowerCase()) {
        setSetupStatus("Approving BLEND from your Fluent account");
        hash = await approveBlendWithFluentAccount(smartAccount);
      } else {
        setSetupStatus("Approving BLEND spend for chess moves");
        hash = await approveBlendWithExternalWallet(wallet);
      }
      await blendPublicClient.waitForTransactionReceipt({ hash });
      setSetupStatus("White player BLEND allowance is ready");
      await refreshChess();
    } catch (error) {
      setSetupStatus(error instanceof Error ? error.message : "Could not approve BLEND");
    } finally {
      setSetupBusy(false);
    }
  }, [gameMeta.white, refreshChess, smartAccount, wallet]);

  const approveBlackBlend = useCallback(async () => {
    if (!CHESS_CONTRACT_ADDRESS) return;
    setSetupBusy(true);
    try {
      setSetupStatus("Approving BLEND from the Fluent Account");
      const hash = await approveBlendWithFluentAccount(smartAccount);
      setSetupStatus(`BLEND approval UserOp submitted: ${formatAddress(hash)}`);
      setLastTxHash(hash);
      await blendPublicClient.waitForTransactionReceipt({ hash });
      setSetupStatus("Fluent Account BLEND allowance is ready");
      await refreshChess();
    } catch (error) {
      setSetupStatus(error instanceof Error ? error.message : "Could not approve Fluent Account BLEND");
    } finally {
      setSetupBusy(false);
    }
  }, [refreshChess, smartAccount]);

  const submitManualMove = useCallback(async (move: Move) => {
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 7. Publish Move: either single tx or batched approve + submitMove.
    if (!CHESS_CONTRACT_ADDRESS) return;
    const next = new Chess(chess.fen());
    next.move(move);
    const moveUci = `${move.from}${move.to}${move.promotion ?? ""}`;
    const moveData = createChessMoveData({ gameId: activeGameId, moveUci, fenAfterMove: next.fen() });

    setManualBusy(true);
    try {
      if (manualActor === "external") {
        if (!whiteAllowanceReady) {
          setSetupStatus("Approve BLEND before submitting a manual move");
          return;
        }
        setSetupStatus(`Submitting manual move ${moveUci}`);
        const hash = await submitChessMoveWithExternalWallet({
          wallet,
          gameId: activeGameId,
          moveUci,
          fenAfterMove: next.fen(),
        });
        setLastTxHash(hash);
        await blendPublicClient.waitForTransactionReceipt({ hash });
      } else if (manualActor === "fluent") {
        if (batchPublishing) {
          setSetupStatus(`Submitting batched approve + move ${moveUci}`);
          const hash = await submitApproveAndMoveBatch({ widget, moveData });
          setLastTxHash(hash);
        } else {
          if (!blackAllowanceReady) {
            setSetupStatus("Approve Fluent BLEND before submitting a manual move");
            return;
          }
          setSetupStatus(`Submitting manual move ${moveUci}`);
          const hash = await sendFluentAccountTransaction(smartAccount, {
            to: CHESS_CONTRACT_ADDRESS,
            data: moveData,
          });
          setLastTxHash(hash);
        }
      } else {
        setSetupStatus("This turn belongs to the other player");
        return;
      }

      setSetupStatus(`Move ${moveUci} submitted`);
      setSelectedSquare(null);
      await refreshChess();
    } catch (error) {
      setSetupStatus(error instanceof Error ? error.message : "Could not submit manual move");
    } finally {
      setManualBusy(false);
    }
  }, [
    batchPublishing,
    activeGameId,
    blackAllowanceReady,
    chess,
    manualActor,
    refreshChess,
    smartAccount,
    wallet,
    widget,
    whiteAllowanceReady,
  ]);

  const handleSquareClick = useCallback((square: string, piece: string) => {
    if (playMode !== "manual" || manualBusy || !gameMeta.active) return;
    if (!selectedSquare) {
      if (!piece) return;
      const isWhitePiece = piece === piece.toUpperCase();
      if ((turnSide === "white" && !isWhitePiece) || (turnSide === "black" && isWhitePiece)) return;
      setSelectedSquare(square);
      return;
    }

    if (square === selectedSquare) {
      setSelectedSquare(null);
      return;
    }

    const move = (chess.moves({ square: selectedSquare as Square, verbose: true }) as Move[]).find(
      (candidate) => candidate.to === square,
    );
    if (!move) {
      if (piece) setSelectedSquare(square);
      return;
    }
    void submitManualMove(move);
  }, [chess, gameMeta.active, manualBusy, playMode, selectedSquare, submitManualMove, turnSide]);

  const registerBotSession = useCallback(async (
    sessionToRegister: typeof permissionSession,
    options: { force?: boolean; status?: string } = {},
  ) => {
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 9. Start Bot Runtime: send the scoped session to the chess bot.
    if (!sessionToRegister) throw new Error("Bot session permission is missing. Sign the permission request first.");
    if (!CHESS_BOT_CONTROL_ENDPOINT) throw new Error("Chess bot control endpoint is not configured");
    if (!gameCreated) throw new Error("Create a game before registering the bot session");
    const sessionKey = [
      activeGameId.toString(),
      sessionToRegister.sessionSignerAddress,
      sessionToRegister.smartAccountAddress,
      "single",
      botLevel,
      CHESS_BOT_MAX_PERMISSIONED_MOVES.toString(),
    ].join(":");
    if (!options.force && registeredBotSessionKey.current === sessionKey && botSessionReady) return;

    if (options.status) setSetupStatus(options.status);
    setBotSessionReady(false);
    console.log("[chess bot] registering session", {
      endpoint: CHESS_BOT_CONTROL_ENDPOINT,
      activeGameId: activeGameId.toString(),
      smartAccountAddress: sessionToRegister.smartAccountAddress,
      sessionSignerAddress: sessionToRegister.sessionSignerAddress,
      batchPublishing: false,
      maxPermissionedMoves: CHESS_BOT_MAX_PERMISSIONED_MOVES,
      botLevel,
    });
    const response = await fetch(`${CHESS_BOT_CONTROL_ENDPOINT}/games/${activeGameId.toString()}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serializedPermissionAccount: sessionToRegister.serializedPermissionAccount,
        smartAccountAddress: sessionToRegister.smartAccountAddress,
        batchApproveMove: false,
        botLevel,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      console.error("[chess bot] registration failed", {
        status: response.status,
        body,
      });
      throw new Error(body?.error ?? `Bot session registration failed (${response.status})`);
    }
    const body = await response.json().catch(() => null) as { sessionGames?: string[] } | null;
    if (!body?.sessionGames?.includes(activeGameId.toString())) {
      console.error("[chess bot] registration response missing active game", {
        activeGameId: activeGameId.toString(),
        body,
      });
      throw new Error("Bot did not confirm the active game session");
    }
    console.log("[chess bot] registration ready", {
      activeGameId: activeGameId.toString(),
      sessionKey,
    });
    registeredBotSessionKey.current = sessionKey;
    setBotSessionReady(true);
  }, [activeGameId, botLevel, botSessionReady, gameCreated]);

  const approveBotMode = useCallback(async () => {
    setPlayMode("bot");
    try {
      if (!gameCreated) {
        setSetupStatus("Create a game first");
        return;
      }
      setSetupBusy(true);
      setSetupStatus(`Approving ${CHESS_BOT_MAX_PERMISSIONED_MOVES} BLEND for permissioned bot moves`);
      console.log("[chess bot] approving bounded BLEND spend", {
        activeGameId: activeGameId.toString(),
        maxPermissionedMoves: CHESS_BOT_MAX_PERMISSIONED_MOVES,
        smartAccountAddress: smartAccount.smartAccountAddress,
      });
      const approvalHash = await approveBlendWithFluentAccount(smartAccount);
      setLastTxHash(approvalHash);
      setSetupStatus(`BLEND approval submitted: ${formatAddress(approvalHash)}`);
      await blendPublicClient.waitForTransactionReceipt({ hash: approvalHash });

      setSetupStatus("Creating scoped ZeroDev session permission");
      console.log("[chess bot] granting ZeroDev session permission", {
        activeGameId: activeGameId.toString(),
        smartAccountAddress: smartAccount.smartAccountAddress,
        smartAccountReady: smartAccount.smartAccountReady,
      });
      const nextSession = await grantChessBotPermission(smartAccount);
      window.localStorage.setItem(CHESS_BOT_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
      setPermissionSession(nextSession);
      setSetupStatus("Registering ZeroDev session with chess bot");
      await registerBotSession(nextSession, {
        force: true,
        status: "Registering ZeroDev session with chess bot",
      });
      if (CHESS_BOT_CONTROL_ENDPOINT) {
        await fetch(`${CHESS_BOT_CONTROL_ENDPOINT}/games/${activeGameKey}/resume`, {
          method: "POST",
        }).catch(() => null);
      }
      setBotSessionReady(true);
      setSetupStatus(`ZeroDev session ready for up to ${CHESS_BOT_MAX_PERMISSIONED_MOVES} BLEND-paid bot moves`);
      await refreshChess();
    } catch (error) {
      setBotSessionReady(false);
      setSetupStatus(error instanceof Error ? error.message : "Could not start auto play");
    } finally {
      setSetupBusy(false);
    }
  }, [
    activeGameId,
    activeGameKey,
    gameCreated,
    registerBotSession,
    refreshChess,
    smartAccount,
  ]);

  useEffect(() => {
    if (
      pendingAutoPrepareGameId === null ||
      pendingAutoPrepareGameId !== activeGameId ||
      playMode !== "bot" ||
      setupBusy ||
      !gameCreated
    ) {
      return;
    }

    setPendingAutoPrepareGameId(null);
    void approveBotMode();
  }, [activeGameId, approveBotMode, gameCreated, pendingAutoPrepareGameId, playMode, setupBusy]);

  useEffect(() => {
    if (!permissionSession || !gameCreated || playMode !== "bot") return;
    void registerBotSession(permissionSession).catch((error) => {
      setSetupStatus(error instanceof Error ? error.message : "Could not register bot session");
    });
  }, [gameCreated, permissionSession, playMode, registerBotSession]);

  const openNewGameSetup = useCallback(() => {
    setDraftBotLevel(botLevel);
    setDraftPlayMode(playMode);
    setDraftBatchPublishing(batchPublishing);
    setCreatingNewGame(true);
  }, [batchPublishing, botLevel, playMode]);

  const submitNewGame = useCallback(async () => {
    const created = await createGame({
      botLevel: draftBotLevel,
      playMode: draftPlayMode,
      batchPublishing: draftBatchPublishing,
    });
    if (created) setCreatingNewGame(false);
  }, [createGame, draftBatchPublishing, draftBotLevel, draftPlayMode]);

  const botConfig = useMemo(() => {
    if (!permissionSession || !CHESS_CONTRACT_ADDRESS) return "";
    return [
      `CHESS_CONTRACT_ADDRESS=${CHESS_CONTRACT_ADDRESS}`,
      "RPC_URL=https://rpc.testnet.fluent.xyz/",
      `PERMISSION_ACCOUNT=${permissionSession.serializedPermissionAccount}`,
      `PERMISSION_SMART_ACCOUNT=${permissionSession.smartAccountAddress}`,
      `GAME_ID=${activeGameId.toString()}`,
      `FROM_BLOCK=${CHESS_FROM_BLOCK.toString()}`,
      `BLEND_TOKEN_ADDRESS=${BLEND_TOKEN_ADDRESS}`,
      `BOT_LEVEL=${botLevel}`,
      "BOT_SIDE=auto",
      "AUTO_DISCOVER_GAMES=true",
      "BATCH_APPROVE_MOVE=false",
      "BATCH_APPROVE_AMOUNT=20",
      `MAX_PERMISSIONED_MOVES=${CHESS_BOT_MAX_PERMISSIONED_MOVES}`,
    ].join("\n");
  }, [activeGameId, botLevel, permissionSession]);

  const copyBotConfig = useCallback(async () => {
    if (!botConfig) {
      setSetupStatus("Select Auto play first to create a session config");
      return;
    }
    await navigator.clipboard.writeText(botConfig);
    setSetupStatus("Copied permissioned bot config");
  }, [botConfig]);

  return (
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 10. Render Demo: controls show the builder flow in the same order.
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
        {gameCreated ? (
          <ChessGameInfo
            activeGameId={activeGameId}
            batchPublishing={batchPublishing}
            botLevel={botLevel}
            gameMeta={gameMeta}
            gamePaused={gamePaused}
            playMode={playMode}
          />
        ) : null}
        <div className="chess-actions">
          <span>{status}</span>
          <strong>{lastMove}</strong>
          {lastTxHash ? <small>UserOp/tx {formatAddress(lastTxHash)}</small> : null}
        </div>
        <ChessSetupControls
          botConfig={botConfig}
          canCreateGame={canCreateGame}
          creatingNewGame={creatingNewGame}
          draftBatchPublishing={draftBatchPublishing}
          draftBotLevel={draftBotLevel}
          draftPlayMode={draftPlayMode}
          gameOngoing={gameOngoing}
          gamePaused={gamePaused}
          permissionSession={permissionSession}
          setupBusy={setupBusy}
          onCancelNewGame={() => setCreatingNewGame(false)}
          onCopyBotConfig={copyBotConfig}
          onDraftBatchPublishingChange={setDraftBatchPublishing}
          onDraftBotLevelChange={setDraftBotLevel}
          onDraftPlayModeChange={setDraftPlayMode}
          onOpenNewGameSetup={openNewGameSetup}
          onPauseChange={setGamePaused}
          onStartAutoPlay={() => void approveBotMode()}
          onSubmitNewGame={() => void submitNewGame()}
        />
        <p className="chess-session">
          Status: {setupBusy ? "pending" : gameCreated ? (botSessionReady ? "active session" : "created") : "pending"}
          {" · "}
          {gameCreated ? (gameMeta.active ? (gamePaused ? "paused" : "active") : "inactive") : "no game"}
          {" · "}
          {setupStatus === "Pending" && gameCreated && botSessionReady ? "Ready" : setupStatus}
        </p>
        <ChessActivity rows={activityRows} />
      </div>

      <ChessBoard
        board={board}
        chessPieces={chessPieces}
        legalTargetSquares={legalTargetSquares}
        manualBusy={manualBusy}
        playMode={playMode}
        selectedSquare={selectedSquare}
        onSquareClick={handleSquareClick}
      />
    </section>
  );
}
