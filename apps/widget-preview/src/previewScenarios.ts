import type { FluentWidgetSession } from "@fluent.xyz/connect";

export const PREVIEW_PUBLIC_API_URL = "https://widget-preview.invalid/api/v1";
const FAMILIES_PATH = "/profile/families/";

type FamiliesPayload = {
  x_handle?: string;
  families: Record<string, { tier: "A" | "B" | "C" | "D" }>;
};

type PreviewReply =
  | { kind: "families"; payload: FamiliesPayload }
  | { kind: "http-error"; status: number; body: string }
  | { kind: "never-resolves" };

export type PreviewScenario = {
  id: string;
  title: string;
  note: string;
  /** `null` renders the widget's disconnected state. */
  session: FluentWidgetSession | null;
  reply?: PreviewReply;
};

function tiers(
  identity: "A" | "B" | "C" | "D",
  tester: "A" | "B" | "C" | "D",
  builder: "A" | "B" | "C" | "D",
  influential: "A" | "B" | "C" | "D",
  predictor: "A" | "B" | "C" | "D",
): FamiliesPayload["families"] {
  return {
    identity: { tier: identity },
    tester: { tier: tester },
    builder: { tier: builder },
    influential: { tier: influential },
    predictor: { tier: predictor },
  };
}

function previewSession(userId: string): FluentWidgetSession {
  return {
    app: {
      mode: "origin",
      origin: globalThis.location?.origin ?? "http://localhost:8070",
      installationId: "widget-preview",
      appName: "Fluent Widget Preview",
    },
    user: { id: userId },
    wallet: {
      smartAccountAddress: "0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E",
      signerAddress: "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4",
    },
    scopes: ["openid", "profile", "wallet", "faucet", "families:read"],
    issuedAt: Math.floor(Date.now() / 1000),
    idToken: "preview.not-a-real-token.signature",
  };
}

export const previewScenarios: PreviewScenario[] = [
  {
    id: "mixed",
    title: "Loaded — mixed tiers",
    note: "The success state, one family per tier.",
    session: previewSession("preview-mixed"),
    reply: {
      kind: "families",
      payload: { x_handle: "@fluent_builder", families: tiers("A", "B", "C", "D", "B") },
    },
  },
  {
    id: "top",
    title: "Loaded — all tier A",
    note: "Longest labels, checks the row layout does not wrap badly.",
    session: previewSession("preview-top"),
    reply: {
      kind: "families",
      payload: { x_handle: "@fluent_maxi", families: tiers("A", "A", "A", "A", "A") },
    },
  },
  {
    id: "low",
    title: "Loaded — all tier D",
    note: "The floor every new account starts from.",
    session: previewSession("preview-low"),
    reply: {
      kind: "families",
      payload: { families: tiers("D", "D", "D", "D", "D") },
    },
  },
  {
    id: "signup",
    title: "No profile yet (404)",
    note: 'The real API answers 404 "user not found" for a session with no reputation profile.',
    session: previewSession("preview-signup"),
    reply: { kind: "http-error", status: 404, body: "user not found" },
  },
  {
    id: "error",
    title: "Request failed (500)",
    note: "Any non-404 failure surfaces the message from the API.",
    session: previewSession("preview-error"),
    reply: {
      kind: "http-error",
      status: 500,
      body: JSON.stringify({ error: "Families service unavailable" }),
    },
  },
  {
    id: "loading",
    title: "Loading",
    note: "Request never settles, so the pending state stays on screen.",
    session: previewSession("preview-loading"),
    reply: { kind: "never-resolves" },
  },
  {
    id: "disconnected",
    title: "Not connected",
    note: "No session, so the widget never builds a families client.",
    session: null,
  },
];

/**
 * Serves the scenario replies above in place of the real families API, keyed by
 * the `privy_id` each preview session sends. Everything else falls through to
 * the network so the rest of the widget behaves normally.
 */
export function installPreviewFamiliesFetch() {
  const repliesByPrivyId = new Map<string, PreviewReply>();
  for (const scenario of previewScenarios) {
    if (scenario.session && scenario.reply) {
      repliesByPrivyId.set(scenario.session.user.id, scenario.reply);
    }
  }

  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!url.includes(FAMILIES_PATH)) {
      return realFetch(input, init);
    }

    const privyId = new URL(url, globalThis.location.origin).searchParams.get("privy_id") ?? "";
    const reply = repliesByPrivyId.get(privyId);
    if (!reply) {
      return new Response(`no preview scenario for privy_id "${privyId}"`, { status: 404 });
    }

    if (reply.kind === "never-resolves") {
      return new Promise<Response>(() => {});
    }

    if (reply.kind === "http-error") {
      return new Response(reply.body, { status: reply.status });
    }

    return new Response(JSON.stringify(reply.payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
