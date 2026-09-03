// The page's view of the partner backend. Only `login` carries the Fluent token; `me` and
// `logout` ride on the partner's own cookie.

export type PartnerUser = { sub: string; address?: string; logins: number };

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${path} → ${res.status}`);
  return body;
}

export const partnerApi = {
  login: (fluentToken: string) =>
    call<{ user: PartnerUser }>("/api/login", {
      method: "POST",
      headers: { Authorization: `Bearer ${fluentToken}` },
    }),
  me: () => call<{ user: PartnerUser }>("/api/me", { method: "GET" }),
  logout: () => call<{ ok: true }>("/api/logout", { method: "POST" }),
};
