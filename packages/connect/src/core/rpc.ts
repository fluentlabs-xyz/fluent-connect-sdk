import { fallback, http, type Chain, type Transport } from "viem";

/** Per-request deadline shared by chain reads, bundler estimation and paymaster authorization. */
export const FLUENT_RPC_TIMEOUT_MS = 30_000;
/** Retries per RPC endpoint before the request fails or moves on to the next URL. */
export const FLUENT_RPC_RETRY_COUNT = 3;
/** Base delay (ms) between retries; viem backs off exponentially from here. */
export const FLUENT_RPC_RETRY_DELAY_MS = 300;

/**
 * Returns the read transport of a Fluent chain: each URL in `rpcUrls.default.http` retries
 * transient failures, then the transport moves on to the next URL. The Fluent chains list one
 * URL each in `@fluent.xyz/registry`, so on them it only retries; a second URL in that list
 * becomes a failover with no code change.
 */
export function createFluentRpcTransport(chain: Chain): Transport {
  const urls = chain.rpcUrls.default.http;
  const endpoints = urls.length > 0 ? urls : [undefined];
  return fallback(
    endpoints.map((url) =>
      http(url, {
        timeout: FLUENT_RPC_TIMEOUT_MS,
        retryCount: FLUENT_RPC_RETRY_COUNT,
        retryDelay: FLUENT_RPC_RETRY_DELAY_MS,
      }),
    ),
    // Each `http()` retries on its own; `fallback` only moves on to the next URL.
    { retryCount: 0 },
  );
}

/**
 * Returns the transport to the ZeroDev bundler at `url`, with the read transport's timeout and
 * retries, so a transient bundler error does not fail the user operation.
 */
export function createFluentBundlerTransport(url: string): Transport {
  return http(url, {
    timeout: FLUENT_RPC_TIMEOUT_MS,
    retryCount: FLUENT_RPC_RETRY_COUNT,
    retryDelay: FLUENT_RPC_RETRY_DELAY_MS,
  });
}
