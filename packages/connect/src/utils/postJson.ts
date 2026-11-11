export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body?: {
      status?: string;
      message?: string;
      error?: string;
      /** fluent-connect-service auth errors: `{code, message}`. */
      code?: string;
    },
  ) {
    super(body?.message ?? body?.error ?? `Request failed with ${status}`);
    this.name = "HttpError";
  }
}

export type RequestJsonOptions = {
  method: string;
  headers?: Record<string, string>;
  /** Serialized as JSON; omit for a request without a body. */
  body?: unknown;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
};

/**
 * Sends one JSON request and returns its parsed body. A non-2xx answer throws an `HttpError`
 * carrying the parsed `{ code, message }` body, so a caller branches on the service's own code
 * rather than on a message string. A 204 resolves to `undefined`; the caller's `T` says whether
 * that can happen.
 */
export async function requestJson<T>(url: string, options: RequestJsonOptions): Promise<T> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const hasBody = options.body !== undefined;
  const response = await doFetch(url, {
    method: options.method,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    let errorBody: HttpError["body"];
    try {
      errorBody = (await response.json()) as HttpError["body"];
    } catch {
      errorBody = undefined;
    }
    throw new HttpError(response.status, errorBody);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  return requestJson<T>(url, { method: "POST", body, headers });
}
