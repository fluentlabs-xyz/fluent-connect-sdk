import {
  encodeFunctionData,
  parseAbi,
  parseUnits,
  type Hash,
} from "viem";
import {
  STBLEND_ASSET_ADDRESS,
  STBLEND_VAULT_ADDRESS,
  vaultPublicClient,
} from "../consts";

export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function maxTotalAssets() view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function deposit(uint256 assets,address receiver) returns (uint256)",
  "function withdraw(uint256 assets,address receiver,address owner) returns (uint256)",
  "function rewardRate() view returns (uint256)",
  "function undistributedRewards() view returns (uint256)",
  "function streamDuration() view returns (uint64)",
  "function periodFinish() view returns (uint64)",
  "function paused() view returns (bool)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const demoThirdPartyAddress = "0x1111111111111111111111111111111111111111" as const;

export type VaultMode = "deposit" | "withdraw";

export type VaultSnapshot = {
  assetAddress: `0x${string}`;
  assetAllowance: bigint;
  assetBalance: bigint;
  assetDecimals: number;
  assetSymbol: string;
  maxDeposit: bigint;
  maxTotalAssets: bigint;
  maxWithdraw: bigint;
  paused: boolean;
  periodFinish: bigint;
  rewardRate: bigint;
  shareBalance: bigint;
  streamDuration: bigint;
  totalAssets: bigint;
  totalSupply: bigint;
  undistributedRewards: bigint;
  vaultDecimals: number;
  vaultName: string;
  vaultSymbol: string;
};

export type VaultTransactionRequest = {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
};

export type SubmittedVaultTransaction = {
  txHash?: Hash;
  status?: string;
  message?: string;
};

export function assertVaultConfigured(): `0x${string}` {
  if (!STBLEND_VAULT_ADDRESS) {
    throw new Error("Configure vault.address in config.json to enable the vault app");
  }
  return STBLEND_VAULT_ADDRESS;
}

function normalizeVaultName(name: string): string {
  return name === "Staked Fluent" ? "Staked BLEND" : name;
}

export function getVaultFill(snapshot: VaultSnapshot | null): string {
  if (!snapshot || snapshot.maxTotalAssets === 0n) return "0%";
  const basisPoints = (snapshot.totalAssets * 10_000n) / snapshot.maxTotalAssets;
  const clamped = basisPoints > 10_000n ? 10_000n : basisPoints;
  return `${Number(clamped) / 100}%`;
}

export function parseVaultAmount(amount: string, decimals: number): bigint | null {
  const normalized = amount.trim();
  if (!normalized || Number(normalized) <= 0) return null;
  try {
    return parseUnits(normalized, decimals);
  } catch {
    return null;
  }
}

export async function readVaultSnapshot(account?: `0x${string}`): Promise<VaultSnapshot> {
  const vaultAddress = assertVaultConfigured();
  const [
    assetFromVault,
    vaultName,
    vaultSymbol,
    vaultDecimals,
    totalAssets,
    totalSupply,
    maxTotalAssets,
    paused,
    rewardRate,
    undistributedRewards,
    streamDuration,
    periodFinish,
  ] = await Promise.all([
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "asset",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "name",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "symbol",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "decimals",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "totalAssets",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "totalSupply",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "maxTotalAssets",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "paused",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "rewardRate",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "undistributedRewards",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "streamDuration",
    }),
    vaultPublicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "periodFinish",
    }),
  ]);
  const assetAddress = STBLEND_ASSET_ADDRESS ?? assetFromVault;
  const [assetSymbol, assetDecimals, assetBalance, assetAllowance, shareBalance, maxDeposit, maxWithdraw] =
    await Promise.all([
      vaultPublicClient.readContract({
        address: assetAddress,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      vaultPublicClient.readContract({
        address: assetAddress,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      account
        ? vaultPublicClient.readContract({
            address: assetAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account],
          })
        : Promise.resolve(0n),
      account
        ? vaultPublicClient.readContract({
            address: assetAddress,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, vaultAddress],
          })
        : Promise.resolve(0n),
      account
        ? vaultPublicClient.readContract({
            address: vaultAddress,
            abi: vaultAbi,
            functionName: "balanceOf",
            args: [account],
          })
        : Promise.resolve(0n),
      account
        ? vaultPublicClient.readContract({
            address: vaultAddress,
            abi: vaultAbi,
            functionName: "maxDeposit",
            args: [account],
          })
        : Promise.resolve(0n),
      account
        ? vaultPublicClient.readContract({
            address: vaultAddress,
            abi: vaultAbi,
            functionName: "maxWithdraw",
            args: [account],
          })
        : Promise.resolve(0n),
    ]);

  return {
    assetAddress,
    assetAllowance,
    assetBalance,
    assetDecimals,
    assetSymbol,
    maxDeposit,
    maxTotalAssets,
    maxWithdraw,
    paused,
    periodFinish,
    rewardRate,
    shareBalance,
    streamDuration,
    totalAssets,
    totalSupply,
    undistributedRewards,
    vaultDecimals,
    vaultName: normalizeVaultName(vaultName),
    vaultSymbol,
  };
}

export async function previewVaultAction(mode: VaultMode, assets: bigint): Promise<bigint> {
  return vaultPublicClient.readContract({
    address: assertVaultConfigured(),
    abi: vaultAbi,
    functionName: mode === "deposit" ? "previewDeposit" : "previewWithdraw",
    args: [assets],
  });
}

export function buildApprovalTransaction(snapshot: VaultSnapshot, assets: bigint): VaultTransactionRequest {
  return {
    to: snapshot.assetAddress,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [assertVaultConfigured(), assets],
    }),
  };
}

export function buildVaultTransaction(
  mode: VaultMode,
  assets: bigint,
  account: `0x${string}`,
): VaultTransactionRequest {
  return {
    to: assertVaultConfigured(),
    data: encodeFunctionData({
      abi: vaultAbi,
      functionName: mode,
      args: mode === "deposit" ? [assets, account] : [assets, account, account],
    }),
  };
}
