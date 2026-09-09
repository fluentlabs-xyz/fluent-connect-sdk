// The page's view of the App backend. Only `login` carries the Fluent token; `me` and
// `logout` ride on the App's own cookie.

export type AppUser = { sub: string; address?: string; logins: number };

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${path} → ${res.status}`);
  return body;
}

export const appApi = {
  login: (fluentToken: string) =>
    call<{ user: AppUser }>("/api/login", {
      method: "POST",
      headers: { Authorization: `Bearer ${fluentToken}` },
    }),
  me: () => call<{ user: AppUser }>("/api/me", { method: "GET" }),
  logout: () => call<{ ok: true }>("/api/logout", { method: "POST" }),
};
