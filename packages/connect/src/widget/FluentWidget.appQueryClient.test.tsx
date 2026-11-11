/**
 * @vitest-environment jsdom
 *
 * An App's own TanStack Query client around `<FluentWidget>` serves the App's pages inside
 * `renderPage`, so a query the App prefetched or hydrated from its server render does not run a
 * second time; an App that mounted none gets the widget's own client.
 *
 * Fakes, and no module of this repository:
 * - `@privy-io/react-auth` 2.25.0, ready with nobody signed in and no Signer;
 * - `@reown/appkit/react` 1.8.20 `createAppKit` and `useAppKit`, the External wallet modal;
 *   `@reown/appkit-adapter-wagmi` 1.8.20 runs for real and mounts the widget's own query client.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConfig } from "../core/config";

// The whole widget mounts per case; under the full parallel suite that can pass Vitest's 5 s
// default, so cases here get 30 s, as the other end-to-end widget tests give theirs.
vi.setConfig({ testTimeout: 30_000 });

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: unknown }) => children,
  usePrivy: () => ({
    ready: true,
    authenticated: false,
    user: null,
    getAccessToken: async () => null,
    login: () => {},
    logout: async () => {},
  }),
  useIdentityToken: () => ({ identityToken: null }),
  useUser: () => ({ refreshUser: async () => {} }),
  useWallets: () => ({ ready: true, wallets: [] }),
  useModalStatus: () => ({ isOpen: false }),
  useCreateWallet: () => ({ createWallet: vi.fn() }),
  useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn() }),
  useLoginWithOAuth: () => ({ initOAuth: vi.fn(), state: { status: "initial" } }),
  useLoginWithPasskey: () => ({ loginWithPasskey: vi.fn() }),
  useLinkWithPasskey: () => ({ linkWithPasskey: vi.fn() }),
  useLinkAccount: () => ({ linkTwitter: vi.fn() }),
  useLoginWithSiwe: () => ({
    generateSiweNonce: vi.fn(),
    loginWithSiwe: vi.fn(),
  }),
  Captcha: () => null,
  useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
}));

vi.mock("@reown/appkit/react", () => ({
  createAppKit: () => ({}),
  useAppKit: () => ({ open: () => {} }),
}));

const { FluentWidget } = await import("./FluentWidget");

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
};

/** The entry a prefetch or an SSR hydration leaves in the App's cache. */
const PREFETCHED_KEY = ["app", "prefetched"] as const;
const PREFETCHED_VALUE = "served from the App cache";

let appQueryClient: QueryClient;
let fetches: number;
let seenClient: QueryClient | undefined;

function AppPage() {
  seenClient = useQueryClient();
  const { data } = useQuery({
    queryKey: PREFETCHED_KEY,
    queryFn: async () => {
      fetches += 1;
      return "fetched over the network";
    },
  });
  return <div data-testid="app-page">{data ?? "pending"}</div>;
}

beforeEach(() => {
  fetches = 0;
  seenClient = undefined;
  appQueryClient = new QueryClient({
    // What an App hydrating a server render ends up with: the entry is fresh, so
    // a cache hit stays a hit and nothing refetches behind it.
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  appQueryClient.setQueryData(PREFETCHED_KEY, PREFETCHED_VALUE);
});

afterEach(() => {
  cleanup();
  appQueryClient.clear();
});

describe("an App's query client around <FluentWidget>", () => {
  it("serves the App's own pages from inside renderPage", async () => {
    render(
      <QueryClientProvider client={appQueryClient}>
        <FluentWidget
          config={CONFIG}
          mode="page"
          connectButton={false}
          renderPage={() => <AppPage />}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("app-page")).toBeTruthy());

    expect(seenClient).toBe(appQueryClient);
    expect(screen.getByTestId("app-page").textContent).toBe(PREFETCHED_VALUE);
    // The App's cache answered, so nothing went out.
    expect(fetches).toBe(0);
  });

  it("keeps the widget's own client for an App that mounted none", async () => {
    render(
      <FluentWidget
        config={CONFIG}
        mode="page"
        connectButton={false}
        renderPage={() => <AppPage />}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("app-page")).toBeTruthy());

    // The widget's client answers, and it holds no entry under this key, so the query runs.
    expect(seenClient).toBeDefined();
    expect(seenClient).not.toBe(appQueryClient);
    await waitFor(() => expect(fetches).toBe(1));
  });
});
