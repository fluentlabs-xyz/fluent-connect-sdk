import { useCallback, useMemo, useState } from "react";

import {
  createMockBridgeAdapter,
  type FluentBridgeExecution,
  type FluentBridgeQuote,
  type FluentBridgeRoute,
  type FluentBridgeRouteRequest,
  type FluentBridgeStatus,
} from "../bridge.js";
import { useFluentConnect } from "../context.js";

const emptyBridgeDefaults: Partial<FluentBridgeRouteRequest> = {};

export type UseFluentBridgeResult = {
  status: FluentBridgeStatus;
  routes: FluentBridgeRoute[];
  quote: FluentBridgeQuote | null;
  execution: FluentBridgeExecution | null;
  error: Error | null;
  discoverRoutes: (request?: Partial<FluentBridgeRouteRequest>) => Promise<FluentBridgeRoute[]>;
  quoteRoute: (route?: FluentBridgeRoute, request?: Partial<FluentBridgeRouteRequest>) => Promise<FluentBridgeQuote>;
  executeQuote: (nextQuote?: FluentBridgeQuote) => Promise<FluentBridgeExecution>;
  refreshStatus: (bridgeId?: string) => Promise<FluentBridgeExecution | null>;
};

export function useFluentBridge(
  defaults: Partial<FluentBridgeRouteRequest> = emptyBridgeDefaults,
): UseFluentBridgeResult {
  const { chain, bridgeAdapter } = useFluentConnect();
  const adapter = useMemo(() => bridgeAdapter ?? createMockBridgeAdapter(), [bridgeAdapter]);
  const [status, setStatus] = useState<FluentBridgeStatus>("idle");
  const [routes, setRoutes] = useState<FluentBridgeRoute[]>([]);
  const [quote, setQuote] = useState<FluentBridgeQuote | null>(null);
  const [execution, setExecution] = useState<FluentBridgeExecution | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const buildRequest = useCallback(
    (request: Partial<FluentBridgeRouteRequest> = {}): FluentBridgeRouteRequest => ({
      toChainId: chain.id,
      ...defaults,
      ...request,
    }),
    [chain.id, defaults],
  );

  const discoverRoutes = useCallback(
    async (request: Partial<FluentBridgeRouteRequest> = {}) => {
      setError(null);
      try {
        const nextRoutes = await adapter.discoverRoutes(buildRequest(request));
        setRoutes(nextRoutes);
        setStatus("route-ready");
        return nextRoutes;
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error("Bridge route discovery failed");
        setError(nextError);
        setStatus("failed");
        throw nextError;
      }
    },
    [adapter, buildRequest],
  );

  const quoteRoute = useCallback(
    async (
      route: FluentBridgeRoute | undefined = routes[0],
      request: Partial<FluentBridgeRouteRequest> = {},
    ) => {
      if (!route) throw new Error("No bridge route available");
      setError(null);
      try {
        const nextQuote = await adapter.getQuote(route, buildRequest(request));
        setQuote(nextQuote);
        setStatus("quote-ready");
        return nextQuote;
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error("Bridge quote failed");
        setError(nextError);
        setStatus("failed");
        throw nextError;
      }
    },
    [adapter, buildRequest, routes],
  );

  const executeQuote = useCallback(
    async (nextQuote: FluentBridgeQuote | undefined = quote ?? undefined) => {
      if (!nextQuote) throw new Error("No bridge quote available");
      setError(null);
      setStatus("pending");
      try {
        const nextExecution = await adapter.execute(nextQuote);
        setExecution(nextExecution);
        setStatus(nextExecution.status);
        return nextExecution;
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error("Bridge execution failed");
        setError(nextError);
        setStatus("failed");
        throw nextError;
      }
    },
    [adapter, quote],
  );

  const refreshStatus = useCallback(
    async (bridgeId: string | undefined = execution?.bridgeId) => {
      if (!bridgeId || !adapter.getStatus) return execution;
      setError(null);
      try {
        const nextExecution = await adapter.getStatus(bridgeId);
        setExecution(nextExecution);
        setStatus(nextExecution.status);
        return nextExecution;
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error("Bridge status check failed");
        setError(nextError);
        setStatus("failed");
        throw nextError;
      }
    },
    [adapter, execution],
  );

  return {
    status,
    routes,
    quote,
    execution,
    error,
    discoverRoutes,
    quoteRoute,
    executeQuote,
    refreshStatus,
  };
}
