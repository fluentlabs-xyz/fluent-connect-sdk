import { fallback, http, type Chain, type Transport } from "viem";

/** Retry attempts per RPC endpoint before failing / falling to the next URL. */
export const FLUENT_RPC_RETRY_COUNT = 3;
/** Base delay (ms) between retries; viem backs off exponentially from here. */
export const FLUENT_RPC_RETRY_DELAY_MS = 300;

/**
 * Read-RPC transport for a Fluent chain. Each endpoint retries transient
 * failures, then falls back to the next URL in `rpcUrls.default.http`. Today the
 * Fluent chains list a single RPC, so this is effectively retry-only — add more
 * URLs to that list and they become automatic failover with no code change.
 */
export function createFluentRpcTransport(chain: Chain): Transport {
  const urls = chain.rpcUrls.default.http;
  const endpoints = urls.length > 0 ? urls : [undefined];
  return fallback(
    endpoints.map((url) =>
      http(url, {
        retryCount: FLUENT_RPC_RETRY_COUNT,
        retryDelay: FLUENT_RPC_RETRY_DELAY_MS,
      }),
    ),
    // Each http() already retries; let fallback only rank/fail over between URLs.
    { retryCount: 0 },
  );
}

/**
 * Bundler / paymaster RPC transport (a single ZeroDev URL) with the same retry
 * policy as reads, so a transient bundler hiccup doesn't fail the whole UserOp.
 */
export function createFluentBundlerTransport(url: string): Transport {
  return http(url, {
    retryCount: FLUENT_RPC_RETRY_COUNT,
    retryDelay: FLUENT_RPC_RETRY_DELAY_MS,
  });
}
