/**
 * @vitest-environment jsdom
 *
 * When the widget renders its debug panel (FLU-1622, criterion 2.7): exactly when the host turns
 * `debugLogging` on, in `mode="home"`. `showDebugPayload` is gone from the props; a JavaScript
 * host that still passes it gets it ignored, not refused (the Issue's Boundary). The panel is the
 * one titled "Host app callback".
 *
 * Nobody is signed in and no wallet is connected, which is the state every page starts in.
 * `zerodevSession.ts`, `reownAppKit.tsx` and every other module of this repository run for real.
 *
 * Fakes, and nothing else (`test/fakes/fluentId.ts` says what each mirrors and how):
 * - `@privy-io/react-auth` 2.25.0, ready with nobody signed in and no Signer;
 * - `@reown/appkit/react` 1.8.20 `createAppKit` and `useAppKit`, the External wallet modal;
 * - `fetch`, so the chain and service requests the page makes on load reach no network.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetBoundary, stubNetwork } from "../../test/fakes/fluentId";
import type { FluentWidgetConfig } from "../core/config";

vi.mock("@privy-io/react-auth", async () =>
  (await import("../../test/fakes/fluentId")).privyModule(),
);
vi.mock("@reown/appkit/react", async () =>
  (await import("../../test/fakes/fluentId")).reownAppKitModule(),
);

const { FluentWidget } = await import("./FluentWidget");
type FluentWidgetProps = import("./FluentWidget").FluentWidgetProps;

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

/**
 * Props as a JavaScript host may pass them: `showDebugPayload` is read past the type on purpose,
 * because a host on 0.5.x still passes it and the widget has to ignore it.
 */
function renderWidget(props: Record<string, unknown>) {
  const all = { config: CONFIG, ...props } as unknown as FluentWidgetProps;
  return render(<FluentWidget {...all} />);
}

/** Whether the debug panel is on screen, once the widget has settled on its first state. */
async function debugPanelShown(): Promise<boolean> {
  await waitFor(() => expect(screen.getByRole("button", { name: /connect/i })).toBeTruthy());
  return screen.queryAllByText("Host app callback").length > 0;
}

beforeEach(() => {
  resetBoundary({ signedIn: false });
  stubNetwork();
  // `debugLogging` writes the widget's diagnostics to the console; none of them is asserted on.
  for (const method of ["log", "debug", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("criterion 2.7: the debug panel", () => {
  it("stays hidden when the host passes neither prop", async () => {
    renderWidget({});
    expect(await debugPanelShown()).toBe(false);
  }, 30_000);

  it("renders in home mode when debugLogging is on", async () => {
    renderWidget({ debugLogging: true });
    expect(await debugPanelShown()).toBe(true);
  }, 30_000);

  it("stays hidden in page mode, even with debugLogging on", async () => {
    renderWidget({ debugLogging: true, mode: "page" });
    await waitFor(() => expect(document.body.textContent).not.toBe(""));
    expect(screen.queryAllByText("Host app callback")).toHaveLength(0);
  }, 30_000);

  it("ignores a showDebugPayload: true a JavaScript host still passes", async () => {
    renderWidget({ showDebugPayload: true, debugLogging: false });
    expect(await debugPanelShown()).toBe(false);
  }, 30_000);

  it("ignores a showDebugPayload: false a JavaScript host still passes", async () => {
    renderWidget({ showDebugPayload: false, debugLogging: true });
    expect(await debugPanelShown()).toBe(true);
  }, 30_000);
});
