export type FluentBridgeAsset = {
  chainId: number;
  symbol: string;
  address?: `0x${string}`;
  decimals: number;
};

export type FluentBridgeRouteRequest = {
  fromChainId?: number;
  toChainId: number;
  fromAddress?: `0x${string}`;
  toAddress?: `0x${string}`;
  asset?: FluentBridgeAsset;
  amount?: string;
};

export type FluentBridgeRoute = {
  routeId: string;
  provider: string;
  fromChainId: number;
  toChainId: number;
  asset: FluentBridgeAsset;
  estimatedTimeSeconds?: number;
  fees?: Array<{
    symbol: string;
    amount: string;
  }>;
  warnings?: string[];
};

export type FluentBridgeQuote = {
  quoteId: string;
  route: FluentBridgeRoute;
  inputAmount: string;
  outputAmount: string;
  expiresAt?: number;
  approvalAddress?: `0x${string}`;
  transaction?: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: string;
  };
};

export type FluentBridgeExecution = {
  bridgeId: string;
  status: FluentBridgeStatus;
  txHash?: `0x${string}`;
  explorerUrl?: string;
};

export type FluentBridgeStatus =
  | "idle"
  | "route-ready"
  | "quote-ready"
  | "pending"
  | "completed"
  | "failed";

export type FluentBridgeAdapter = {
  discoverRoutes: (request: FluentBridgeRouteRequest) => Promise<FluentBridgeRoute[]>;
  getQuote: (route: FluentBridgeRoute, request: FluentBridgeRouteRequest) => Promise<FluentBridgeQuote>;
  execute: (quote: FluentBridgeQuote) => Promise<FluentBridgeExecution>;
  getStatus?: (bridgeId: string) => Promise<FluentBridgeExecution>;
};

export function createMockBridgeAdapter(): FluentBridgeAdapter {
  return {
    async discoverRoutes(request) {
      return [
        {
          routeId: "mock-route-fluent",
          provider: "Fluent Bridge",
          fromChainId: request.fromChainId ?? 1,
          toChainId: request.toChainId,
          asset: request.asset ?? {
            chainId: request.toChainId,
            symbol: "BLEND",
            decimals: 18,
          },
          estimatedTimeSeconds: 180,
          warnings: ["Demo route. Wire a bridge provider before production use."],
        },
      ];
    },
    async getQuote(route, request) {
      return {
        quoteId: `quote_${route.routeId}`,
        route,
        inputAmount: request.amount ?? "0",
        outputAmount: request.amount ?? "0",
        expiresAt: Math.floor(Date.now() / 1000) + 120,
      };
    },
    async execute(quote) {
      return {
        bridgeId: `bridge_${quote.quoteId}`,
        status: "pending",
      };
    },
    async getStatus(bridgeId) {
      return {
        bridgeId,
        status: "pending",
      };
    },
  };
}
