import { z } from "zod";

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid checksummed or hex address");

export const contractEntrySchema = z.object({
  address: addressSchema,
  implementation: addressSchema.optional(),
});

export const fluentChainSchema = z.object({
  id: z.string(),
  name: z.string(),
  chainId: z.number().int().positive(),
  testnet: z.boolean(),
  nativeCurrency: z.object({
    name: z.string(),
    symbol: z.string(),
    decimals: z.number().int(),
  }),
  rpcUrls: z.object({
    default: z.object({
      http: z.array(z.string().url()),
      webSocket: z.array(z.string().url()).optional(),
    }),
  }),
  blockExplorers: z.object({
    default: z.object({
      name: z.string(),
      url: z.string().url(),
    }),
  }),
  infoURL: z.string().url(),
  faucets: z.array(z.string().url()).optional(),
  parent: z
    .object({
      type: z.literal("L2"),
      chainId: z.number().int().positive(),
      bridgeUrl: z.string().url(),
    })
    .optional(),
  contracts: z
    .object({
      fluentBridge: contractEntrySchema.optional(),
      // Gateways are what a bridge transfer actually calls; the bridge contract
      // itself only prices the message (`getSentMessageFee`).
      nativeGateway: contractEntrySchema.optional(),
      erc20Gateway: contractEntrySchema.optional(),
      wethGateway: contractEntrySchema.optional(),
      universalTokenFactory: contractEntrySchema.optional(),
      paymentGateway: contractEntrySchema.optional(),
      peggedTokenPrecompile: z.object({ address: addressSchema }).optional(),
    })
    .optional(),
});

export const l1ChainSchema = z.object({
  id: z.string(),
  name: z.string(),
  chainId: z.number().int().positive(),
  testnet: z.boolean(),
  nativeCurrency: z.object({
    name: z.string(),
    symbol: z.string(),
    decimals: z.number().int(),
  }),
  rpcUrls: z.object({
    default: z.object({
      http: z.array(z.string().url()),
    }),
  }),
  blockExplorers: z.object({
    default: z.object({
      name: z.string(),
      url: z.string().url(),
    }),
  }),
  pairedL2: z.string().optional(),
  contracts: z.record(z.string(), contractEntrySchema).optional(),
});

export const appSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().optional(),
  docs: z.string().url().optional(),
  deployments: z.record(z.string(), z.object({
    contract: z.string(),
    address: addressSchema,
  })),
});

/**
 * One Fluent chain as the registry describes it: its ids, native currency, RPC and explorer
 * endpoints, its L1 parent and its contracts. Declared rather than inferred from
 * `fluentChainSchema`, so its shape is what this file says; `chainDefinitionMatchesSchema`
 * below fails the build if the two drift apart.
 */
export type FluentChainDefinition = {
  /** The registry's own id: `"fluent-testnet"`, `"fluent-mainnet"`. */
  id: string;
  name: string;
  chainId: number;
  testnet: boolean;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: { default: { http: string[]; webSocket?: string[] } };
  blockExplorers: { default: { name: string; url: string } };
  infoURL: string;
  faucets?: string[];
  /** The L1 the chain settles to, and where its bridge is. */
  parent?: { type: "L2"; chainId: number; bridgeUrl: string };
  /** Addresses of the chain's system contracts, each with its implementation when proxied. */
  contracts?: {
    fluentBridge?: { address: string; implementation?: string };
    nativeGateway?: { address: string; implementation?: string };
    erc20Gateway?: { address: string; implementation?: string };
    wethGateway?: { address: string; implementation?: string };
    universalTokenFactory?: { address: string; implementation?: string };
    paymentGateway?: { address: string; implementation?: string };
    peggedTokenPrecompile?: { address: string };
  };
};

type FluentChainSchemaOutput = z.infer<typeof fluentChainSchema>;
/** A compile-time check only: `true` exactly when the declared type and the schema agree. */
export const chainDefinitionMatchesSchema: [FluentChainDefinition] extends [FluentChainSchemaOutput]
  ? [FluentChainSchemaOutput] extends [FluentChainDefinition]
    ? true
    : never
  : never = true;
export type L1ChainDefinition = z.infer<typeof l1ChainSchema>;
export type AppDefinition = z.infer<typeof appSchema>;

export const zerodevIntegrationSchema = z.object({
  id: z.literal("zerodev"),
  name: z.string(),
  description: z.string(),
  docs: z.string().url(),
  dashboard: z.string().url(),
  rpcUrlTemplate: z.string(),
  supportedFluentChains: z.array(
    z.object({
      fluentChainId: z.string(),
      chainId: z.number().int().positive(),
    }),
  ),
  privy: z.object({
    docs: z.string().url(),
    embeddedWalletCreateOnLogin: z.string(),
  }),
});

export type ZerodevIntegration = z.infer<typeof zerodevIntegrationSchema>;
