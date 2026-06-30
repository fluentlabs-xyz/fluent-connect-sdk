import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  formatUnits,
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
  rpcUrls: { default: { http: [process.env.RPC_URL ?? "https://rpc.testnet.fluent.xyz/"] } },
} as const;

const chessAbi = parseAbi([
  "event GameCreated(uint256 indexed gameId,address indexed white,address indexed black)",
  "function createGame(address blackPlayer) returns (uint256 gameId)",
  "function approveOperator(uint256 gameId,address operator,bool approved)",
  "function games(uint256 gameId) view returns (address white,address black,address turn,bool active,uint64 moveCount,uint8 result)",
]);
const erc20Abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);

const contractAddress = requiredAddress("CHESS_CONTRACT_ADDRESS");
const blendAddress = (process.env.BLEND_TOKEN_ADDRESS ?? "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E") as Address;
const black = requiredAddress("PERMISSION_SMART_ACCOUNT");
const whiteKey = normalizePrivateKey(requiredAny(["WHITE_PRIVATE_KEY", "PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]));
const whiteOperator = (process.env.WHITE_OPERATOR_ADDRESS || "") as Address;
const account = privateKeyToAccount(whiteKey);
const publicClient = createPublicClient({ chain: fluentTestnet, transport: http(fluentTestnet.rpcUrls.default.http[0]) });
const walletClient = createWalletClient({ account, chain: fluentTestnet, transport: http(fluentTestnet.rpcUrls.default.http[0]) });
const chess = getContract({ address: contractAddress, abi: chessAbi, client: { public: publicClient, wallet: walletClient } });
const blend = getContract({ address: blendAddress, abi: erc20Abi, client: { public: publicClient, wallet: walletClient } });

const [nativeBalance, blendBalance] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  blend.read.balanceOf([account.address]),
]);
console.log(`[setup] white ${account.address}`);
console.log(`[setup] native ${formatEther(nativeBalance)} ETH, BLEND ${formatUnits(blendBalance, 18)}`);
if (nativeBalance === 0n) throw new Error("white/deployer key address has no native gas token");
if (blendBalance < parseUnits("12", 18)) throw new Error("white/deployer key address needs at least 12 BLEND");

console.log(`[setup] creating game vs black ${black}`);
const createHash = await chess.write.createGame([black]);
console.log(`[setup] create tx ${createHash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
let gameId: bigint | null = null;
for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({ abi: chessAbi, data: log.data, topics: log.topics });
    if (decoded.eventName === "GameCreated") gameId = decoded.args.gameId;
  } catch {}
}
if (gameId === null) throw new Error("GameCreated event not found");
console.log(`[setup] game ${gameId.toString()} created`);

const blackBlendBalance = await blend.read.balanceOf([black]);
if (blackBlendBalance < parseUnits("10", 18)) {
  const topUp = parseUnits("10", 18) - blackBlendBalance;
  console.log(`[setup] funding black permission account with ${formatUnits(topUp, 18)} BLEND`);
  const transferHash = await blend.write.transfer([black, topUp]);
  console.log(`[setup] transfer tx ${transferHash}`);
  await publicClient.waitForTransactionReceipt({ hash: transferHash });
}

const allowance = await blend.read.allowance([account.address, contractAddress]);
if (allowance < parseUnits("50", 18)) {
  console.log("[setup] approving white BLEND");
  const approveHash = await blend.write.approve([contractAddress, parseUnits("50", 18)]);
  console.log(`[setup] approve tx ${approveHash}`);
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
}

if (whiteOperator && /^0x[a-fA-F0-9]{40}$/.test(whiteOperator) && whiteOperator.toLowerCase() !== account.address.toLowerCase()) {
  console.log(`[setup] approving white operator ${whiteOperator}`);
  const opHash = await chess.write.approveOperator([gameId, whiteOperator, true]);
  console.log(`[setup] operator tx ${opHash}`);
  await publicClient.waitForTransactionReceipt({ hash: opHash });
}

console.log(`GAME_ID=${gameId.toString()}`);
console.log(`WHITE_ADDRESS=${account.address}`);


function normalizePrivateKey(value: string) {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  const prefixed = cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(prefixed)) {
    throw new Error("private key must be 32-byte hex, with or without 0x prefix");
  }
  return prefixed as Hex;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredAny(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required`);
}
function requiredAddress(name: string) {
  const value = required(name);
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${name} must be an address`);
  return value as Address;
}
