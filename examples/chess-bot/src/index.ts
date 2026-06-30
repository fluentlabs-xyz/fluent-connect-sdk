import "dotenv/config";
import { deserializePermissionAccount } from "@zerodev/permissions";
import {
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { Chess, type Move } from "chess.js";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getContract,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const fluentTestnet = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.RPC_URL ?? "https://rpc.testnet.fluent.xyz/"],
    },
  },
} as const;

const abi = parseAbi([
  "event GameCreated(uint256 indexed gameId,address indexed white,address indexed black)",
  "event MoveSubmitted(uint256 indexed gameId,uint256 indexed moveNumber,address indexed player,address operator,string moveUci,string fenAfterMove)",
  "function submitMove(uint256 gameId,string moveUci,string fenAfterMove)",
  "function games(uint256 gameId) view returns (address white,address black,address turn,bool active,uint64 moveCount,uint8 result)",
  "function isAuthorizedOperator(uint256 gameId,address player,address operator) view returns (bool)",
]);
const erc20Abi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);

type BotSide = "white" | "black" | "auto";
type BotLevel = "easy" | "medium" | "hard";

const contractAddress = requiredAddress("CHESS_CONTRACT_ADDRESS");
const fixedGameId = process.env.GAME_ID ? BigInt(process.env.GAME_ID) : null;
const fromBlock = BigInt(process.env.FROM_BLOCK ?? "0");
const privateKey = normalizePrivateKey(requiredAny(["BOT_PRIVATE_KEY", "PRIVATE_KEY", "WHITE_PRIVATE_KEY"]));
const side = (process.env.BOT_SIDE ?? "auto") as BotSide;
const botLevel = (process.env.BOT_LEVEL ?? "medium") as BotLevel;
const pollMs = Number(process.env.POLL_MS ?? "1200");
const autoDiscoverGames = process.env.AUTO_DISCOVER_GAMES !== "false";
const staleAfterSeconds = BigInt(process.env.STALE_AFTER_SECONDS ?? "300");
const zeroDevProjectId = process.env.ZERO_DEV_PROJECT_ID;
const serializedPermissionAccount = process.env.PERMISSION_ACCOUNT;
const permissionSmartAccount = process.env.PERMISSION_SMART_ACCOUNT as Address | undefined;
const blendTokenAddress = (process.env.BLEND_TOKEN_ADDRESS ??
  "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E") as Address;
const batchApproveMove = process.env.BATCH_APPROVE_MOVE === "true";
const batchApproveAmount = parseUnits(process.env.BATCH_APPROVE_AMOUNT ?? "50", 18);

if (side !== "white" && side !== "black" && side !== "auto") {
  throw new Error("BOT_SIDE must be white, black, or auto");
}
if (botLevel !== "easy" && botLevel !== "medium" && botLevel !== "hard") {
  throw new Error("BOT_LEVEL must be easy, medium, or hard");
}

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(fluentTestnet.rpcUrls.default.http[0]),
});
const walletClient = createWalletClient({
  account,
  chain: fluentTestnet,
  transport: http(fluentTestnet.rpcUrls.default.http[0]),
});
const contract = getContract({
  address: contractAddress,
  abi,
  client: { public: publicClient, wallet: walletClient },
});
const permissionClient = await createPermissionClient();

const lastSubmittedMoveByGame = new Map<bigint, bigint>();
const connectedGames = new Set<string>();
const blockTimestampCache = new Map<bigint, bigint>();

console.log(
  autoDiscoverGames
    ? `[chess-bot] ${side} ${botLevel} bot ${account.address} discovering active games on ${contractAddress} from block ${fromBlock}`
    : `[chess-bot] ${side} ${botLevel} bot ${account.address} watching game ${fixedGameId} on ${contractAddress} from block ${fromBlock}`,
);
if (permissionClient) {
  console.log(`[chess-bot] permission account active for ${permissionClient.accountAddress}`);
}

for (;;) {
  try {
    if (autoDiscoverGames) {
      await tickAutoDiscovery();
    } else {
      if (fixedGameId === null) throw new Error("GAME_ID is required when AUTO_DISCOVER_GAMES=false");
      await tickGame(fixedGameId);
    }
  } catch (error) {
    console.error("[chess-bot] tick failed", error);
  }
  await sleep(pollMs);
}

async function tickAutoDiscovery() {
  const games = await discoverOngoingGames();
  const nextConnected = new Set(games.map((game) => game.gameId.toString()));

  for (const gameId of connectedGames) {
    if (!nextConnected.has(gameId)) {
      console.log(`[chess-bot] disconnecting stale game ${gameId}`);
    }
  }
  for (const game of games) {
    if (!connectedGames.has(game.gameId.toString())) {
      console.log(
        `[chess-bot] connected to ongoing game ${game.gameId}; last activity ${game.ageSeconds}s ago`,
      );
    }
  }

  connectedGames.clear();
  for (const game of games) connectedGames.add(game.gameId.toString());
  for (const game of games) await tickGame(game.gameId);
}

async function discoverOngoingGames() {
  const [createdEvents, moveEvents, latestBlock] = await Promise.all([
    publicClient.getContractEvents({
      address: contractAddress,
      abi,
      eventName: "GameCreated",
      fromBlock,
      toBlock: "latest",
    }),
    publicClient.getContractEvents({
      address: contractAddress,
      abi,
      eventName: "MoveSubmitted",
      fromBlock,
      toBlock: "latest",
    }),
    publicClient.getBlock({ blockTag: "latest" }),
  ]);

  const latestMoveByGame = new Map<bigint, { blockNumber: bigint; moveNumber: bigint }>();
  for (const event of moveEvents) {
    const gameId = event.args.gameId;
    const moveNumber = event.args.moveNumber ?? 0n;
    if (gameId === undefined || event.blockNumber === undefined) continue;
    const current = latestMoveByGame.get(gameId);
    if (!current || moveNumber > current.moveNumber) {
      latestMoveByGame.set(gameId, { blockNumber: event.blockNumber, moveNumber });
    }
  }

  const latestTimestamp = latestBlock.timestamp;
  const ongoing: Array<{ gameId: bigint; ageSeconds: bigint }> = [];
  for (const event of createdEvents) {
    const gameId = event.args.gameId;
    if (gameId === undefined || event.blockNumber === undefined) continue;

    const game = await contract.read.games([gameId]);
    const [, , , active] = game;
    if (!active) continue;

    const activityBlock = latestMoveByGame.get(gameId)?.blockNumber ?? event.blockNumber;
    const activityTimestamp = await getBlockTimestamp(activityBlock);
    const ageSeconds = latestTimestamp > activityTimestamp ? latestTimestamp - activityTimestamp : 0n;
    if (ageSeconds <= staleAfterSeconds) ongoing.push({ gameId, ageSeconds });
  }

  ongoing.sort((a, b) => Number(a.gameId - b.gameId));
  return ongoing;
}

async function tickGame(gameId: bigint) {
  const game = await contract.read.games([gameId]);
  const [white, black, turn, active, moveCount] = game;

  if (!active) {
    console.log("[chess-bot] game inactive");
    return;
  }

  const turnSide: Exclude<BotSide, "auto"> = turn.toLowerCase() === white.toLowerCase() ? "white" : "black";
  if (side !== "auto" && side !== turnSide) {
    return;
  }

  const canUsePermissionAccount =
    permissionClient && turn.toLowerCase() === permissionClient.accountAddress.toLowerCase();
  const authorized = canUsePermissionAccount
    ? true
    : await contract.read.isAuthorizedOperator([gameId, turn, account.address]);
  if (!authorized) {
    return;
  }

  const lastSubmittedMove = lastSubmittedMoveByGame.get(gameId) ?? -1n;
  if (moveCount <= lastSubmittedMove) {
    return;
  }

  const chess = await reconstructBoard(gameId);
  const expectedTurn = turnSide === "white" ? "w" : "b";
  if (chess.turn() !== expectedTurn) {
    console.warn(
      `[chess-bot] game ${gameId} chain turn is ${turnSide}, but board turn is ${chess.turn()}; skipping`,
    );
    return;
  }

  const move = chooseMove(chess, botLevel);
  if (!move) {
    console.log("[chess-bot] no legal moves available");
    return;
  }

  const next = new Chess(chess.fen());
  next.move(move);
  const moveUci = `${move.from}${move.to}${move.promotion ?? ""}`;
  const fenAfterMove = next.fen();

  console.log(`[chess-bot] game ${gameId} submitting ${moveUci} for ${turnSide}`);
  const hash = canUsePermissionAccount
    ? await submitPermissionedMove(gameId, moveUci, fenAfterMove)
    : await contract.write.submitMove([gameId, moveUci, fenAfterMove]);
  console.log(
    canUsePermissionAccount
      ? `[chess-bot] sponsored userop tx ${hash}${batchApproveMove ? " (batched approve + move)" : ""}`
      : `[chess-bot] tx ${hash}`,
  );
  await publicClient.waitForTransactionReceipt({ hash });
  lastSubmittedMoveByGame.set(gameId, moveCount);
  console.log(`[chess-bot] game ${gameId} confirmed ${moveUci}`);
}

async function submitPermissionedMove(gameId: bigint, moveUci: string, fenAfterMove: string) {
  if (!permissionClient) throw new Error("permission client is not initialized");
  const moveData = encodeFunctionData({
    abi,
    functionName: "submitMove",
    args: [gameId, moveUci, fenAfterMove],
  });

  if (batchApproveMove) {
    return permissionClient.client.sendTransaction({
      account: permissionClient.account,
      chain: fluentTestnet,
      calls: [
        {
          to: blendTokenAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [contractAddress, batchApproveAmount],
          }),
          value: 0n,
        },
        {
          to: contractAddress,
          data: moveData,
          value: 0n,
        },
      ],
    });
  }

  return permissionClient.client.sendTransaction({
    account: permissionClient.account,
    chain: fluentTestnet,
    to: contractAddress,
    data: moveData,
    value: 0n,
  });
}

async function createPermissionClient() {
  if (!serializedPermissionAccount) return null;
  if (!zeroDevProjectId) throw new Error("ZERO_DEV_PROJECT_ID is required when PERMISSION_ACCOUNT is set");

  const zeroDevRpcUrl = `https://rpc.zerodev.app/api/v3/${zeroDevProjectId}/chain/${fluentTestnet.id}`;
  const account = await deserializePermissionAccount(
    publicClient,
    getEntryPoint("0.7"),
    KERNEL_V3_3,
    serializedPermissionAccount,
  );

  if (
    permissionSmartAccount &&
    account.address.toLowerCase() !== permissionSmartAccount.toLowerCase()
  ) {
    throw new Error(
      `PERMISSION_SMART_ACCOUNT ${permissionSmartAccount} does not match serialized account ${account.address}`,
    );
  }

  const paymaster = createZeroDevPaymasterClient({
    chain: fluentTestnet,
    transport: http(zeroDevRpcUrl),
  });
  const client = createKernelAccountClient({
    account,
    chain: fluentTestnet,
    bundlerTransport: http(zeroDevRpcUrl),
    client: publicClient,
    paymaster: {
      getPaymasterData: (userOperation) =>
        paymaster.sponsorUserOperation({ userOperation }),
    },
  });

  return {
    account,
    accountAddress: account.address,
    client,
  };
}

async function reconstructBoard(gameId: bigint) {
  const events = await publicClient.getContractEvents({
    address: contractAddress,
    abi,
    eventName: "MoveSubmitted",
    args: { gameId },
    fromBlock,
    toBlock: "latest",
  });

  const latest = events
    .map((event) => event.args)
    .filter((args) => args.gameId === gameId)
    .sort((a, b) => Number((a.moveNumber ?? 0n) - (b.moveNumber ?? 0n)))
    .at(-1);

  return latest?.fenAfterMove ? new Chess(latest.fenAfterMove) : new Chess();
}

async function getBlockTimestamp(blockNumber: bigint) {
  const cached = blockTimestampCache.get(blockNumber);
  if (cached !== undefined) return cached;

  const block = await publicClient.getBlock({ blockNumber });
  blockTimestampCache.set(blockNumber, block.timestamp);
  return block.timestamp;
}

function chooseMove(chess: Chess, level: BotLevel): Move | null {
  const legalMoves = chess.moves({ verbose: true }) as Move[];
  if (legalMoves.length === 0) return null;

  const scored = legalMoves.map((move) => {
    let score = Math.random() * (level === "easy" ? 9 : level === "medium" ? 2 : 0.25);
    if (move.captured) score += pieceValue(move.captured) * (level === "easy" ? 2 : level === "medium" ? 10 : 18);
    if (move.promotion) score += pieceValue(move.promotion) * (level === "easy" ? 3 : level === "medium" ? 8 : 14);
    if (level !== "easy") {
      score += centerBias(move.to) * (level === "medium" ? 0.8 : 1.8);
      if (move.piece === "n" || move.piece === "b") score += level === "medium" ? 0.4 : 0.9;
    }

    const probe = new Chess(chess.fen());
    probe.move(move);
    if (probe.inCheck()) score += level === "easy" ? 1 : level === "medium" ? 4 : 8;
    if (probe.isCheckmate()) score += 1000;
    return { move, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.move ?? null;
}

function centerBias(square: string) {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]) - 1;
  const dx = Math.abs(file - 3.5);
  const dy = Math.abs(rank - 3.5);
  return Math.max(0, 3.5 - dx - dy / 2);
}

function pieceValue(piece: string) {
  switch (piece.toLowerCase()) {
    case "p":
      return 1;
    case "n":
    case "b":
      return 3;
    case "r":
      return 5;
    case "q":
      return 9;
    default:
      return 0;
  }
}

function normalizePrivateKey(value: string) {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  const prefixed = cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(prefixed)) {
    throw new Error("private key must be 32-byte hex, with or without 0x prefix");
  }
  return prefixed as Hex;
}

function requiredAny(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required`);
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredAddress(name: string) {
  const value = required(name);
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${name} must be an address`);
  return value as Address;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
