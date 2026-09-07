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

export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
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

  return response.json() as Promise<T>;
}
