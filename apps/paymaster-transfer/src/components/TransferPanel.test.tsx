// @vitest-environment jsdom
/**
 * What the transfer panel's runtime log records: the page load, every session and account
 * state, the console lines it mirrors and the Signer's log events, under StrictMode.
 *
 * Fakes:
 * - the host's `FluentBatchApi` and `FluentWidgetSession` of `@fluent.xyz/connect`, as plain
 *   objects of the shapes its widget hands an App;
 * - `console.log`, `console.warn` and `console.error`, silenced spies the panel wraps;
 * - `Date`, frozen by Vitest's fake timers so the log's timestamps are fixed.
 */
import type { FluentBatchApi, FluentWidgetAccount, FluentWidgetSession } from "@fluent.xyz/connect";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TransferPanel } from "./TransferPanel";

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A";
const OTHER_ACCOUNT = "0x1111111111111111111111111111111111111111";
const STAMP = "12:00:00";

const SESSION: FluentWidgetSession = {
  account: { address: SMART_ACCOUNT, type: "smart" },
  issuedAt: 1_700_000_000,
};

function widgetWith(account: Partial<FluentWidgetAccount> = {}): FluentBatchApi {
  return {
    account: {
      connected: false,
      executionReady: false,
      executionStatus: "disconnected",
      capabilities: { atomicBatch: true, erc20Gas: true },
      ...account,
    },
    signingMode: "prompt",
    gasPayment: { symbol: "ETH", decimals: 18 },
    createBatchOp: vi.fn(),
    signMessage: vi.fn(),
    signTypedData: vi.fn(),
  };
}

function panel(session: FluentWidgetSession | null, widget: FluentBatchApi) {
  return (
    <StrictMode>
      <TransferPanel session={session} widget={widget} />
    </StrictMode>
  );
}

function logLines(): string[] {
  return document.querySelector(".runtime-logs pre")?.textContent?.split("\n") ?? [];
}

function newLines(before: string[]): string[] {
  return logLines().slice(before.length);
}

const pageLoaded = () => `${STAMP}  page loaded: ${location.href}`;
const sessionLine = (session: FluentWidgetSession | null) =>
  `${STAMP}  session | account=${session?.account.address ?? "none"} | type=${
    session?.account.type ?? "none"
  } | issuedAt=${session?.issuedAt ?? "none"}`;

let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-01T12:00:00.000Z") });
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TransferPanel's mount", () => {
  it("logs the page load, the session and the account twice, once per StrictMode effect pass", () => {
    render(panel(SESSION, widgetWith({ address: SMART_ACCOUNT, connected: true })));

    const account = `${STAMP}  account=${SMART_ACCOUNT} | connected=true | execution=disconnected`;
    // Pins current behaviour: StrictMode's second effect pass appends each mount line again.
    expect(logLines()).toEqual([
      pageLoaded(),
      sessionLine(SESSION),
      account,
      pageLoaded(),
      sessionLine(SESSION),
      account,
    ]);
  });

  it("shows the waiting placeholder only before any line is logged, so never after mount", () => {
    render(panel(null, widgetWith()));

    expect(logLines()).not.toContain("Waiting for account state...");
    expect(logLines()[1]).toBe(sessionLine(null));
    expect(logLines()[2]).toBe(`${STAMP}  account=none | connected=false | execution=disconnected`);
  });
});

describe("the console mirror", () => {
  it("appends one line per Fluent, Privy or ZeroDev console call and none for any other", () => {
    render(panel(SESSION, widgetWith({ address: SMART_ACCOUNT })));
    const before = logLines();

    act(() => {
      console.log("[fluent widget] ready", { step: 1 });
      console.warn("[privy] slow");
      console.error("[ZeroDev] refused", new Error("boom"));
      console.log("unrelated line");
    });

    // One wrapper reaches the console it found: StrictMode's cleanup put that console back
    // before the second effect pass wrapped it again.
    expect(consoleLog).toHaveBeenCalledTimes(2);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(newLines(before)).toEqual([
      `${STAMP}  log: [fluent widget] ready {"step":1}`,
      `${STAMP}  warn: [privy] slow`,
      `${STAMP}  error: [ZeroDev] refused Error: boom`,
    ]);
  });

  it("keeps mirroring into the live log after renders that change every prop", () => {
    const { rerender } = render(panel(SESSION, widgetWith({ address: SMART_ACCOUNT })));
    rerender(panel(null, widgetWith({ address: OTHER_ACCOUNT, connected: true })));
    const before = logLines();

    act(() => {
      console.log("[fluent] after rerender");
    });

    // Pins current behaviour: the mirror keeps the first render's appendLog, which still appends to the current list because it only calls the state setter.
    expect(newLines(before)).toEqual([`${STAMP}  log: [fluent] after rerender`]);
  });

  it("puts the console it found back on unmount", () => {
    const { unmount } = render(panel(SESSION, widgetWith()));
    expect(console.log).not.toBe(consoleLog);

    unmount();

    expect(console.log).toBe(consoleLog);
    expect(console.warn).toBe(consoleWarn);
    expect(console.error).toBe(consoleError);
  });
});

describe("the session line", () => {
  it("logs once per new session object, the same fields included, and not on an unrelated render", () => {
    const widget = widgetWith({ address: SMART_ACCOUNT, connected: true });
    const { rerender } = render(panel(SESSION, widget));

    let before = logLines();
    rerender(panel(SESSION, widgetWith({ address: SMART_ACCOUNT, connected: true })));
    expect(newLines(before)).toEqual([]);

    before = logLines();
    const sameFields = { ...SESSION, account: { ...SESSION.account } };
    rerender(panel(sameFields, widget));
    // Pins current behaviour: a new session object with the same fields is logged again.
    expect(newLines(before)).toEqual([sessionLine(SESSION)]);

    before = logLines();
    rerender(panel(null, widget));
    expect(newLines(before)).toEqual([sessionLine(null)]);
  });
});

describe("the account line", () => {
  it("logs once for each of the address, connection, status and error it lists", () => {
    const { rerender } = render(panel(null, widgetWith()));

    let before = logLines();
    rerender(panel(null, widgetWith({ address: SMART_ACCOUNT })));
    expect(newLines(before)).toEqual([
      `${STAMP}  account=${SMART_ACCOUNT} | connected=false | execution=disconnected`,
    ]);

    before = logLines();
    rerender(panel(null, widgetWith({ address: SMART_ACCOUNT, connected: true })));
    expect(newLines(before)).toEqual([
      `${STAMP}  account=${SMART_ACCOUNT} | connected=true | execution=disconnected`,
    ]);

    before = logLines();
    rerender(
      panel(
        null,
        widgetWith({ address: SMART_ACCOUNT, connected: true, executionStatus: "error" }),
      ),
    );
    expect(newLines(before)).toEqual([
      `${STAMP}  account=${SMART_ACCOUNT} | connected=true | execution=error`,
    ]);

    before = logLines();
    rerender(
      panel(
        null,
        widgetWith({
          address: SMART_ACCOUNT,
          connected: true,
          executionStatus: "error",
          executionError: "Signer missing",
        }),
      ),
    );
    expect(newLines(before)).toEqual([
      `${STAMP}  account=${SMART_ACCOUNT} | connected=true | execution=error | error=Signer missing`,
    ]);
  });

  it("logs the session's account when the widget names none, and again when the session's changes", () => {
    const widget = widgetWith({ connected: true });
    const { rerender } = render(panel(null, widget));

    const before = logLines();
    rerender(panel(SESSION, widget));

    expect(newLines(before)).toEqual([
      sessionLine(SESSION),
      `${STAMP}  account=${SMART_ACCOUNT} | connected=true | execution=disconnected`,
    ]);
  });

  it("logs nothing when only readiness or the account type changes, and renders the change", () => {
    const { rerender, getByText, queryByText } = render(
      panel(SESSION, widgetWith({ address: SMART_ACCOUNT, connected: true })),
    );
    expect(queryByText("Smart account ready")).toBeNull();

    const before = logLines();
    rerender(
      panel(
        SESSION,
        widgetWith({
          address: SMART_ACCOUNT,
          connected: true,
          executionReady: true,
          type: "smart",
        }),
      ),
    );

    expect(newLines(before)).toEqual([]);
    expect(getByText("Smart account ready")).toBeTruthy();
    expect(getByText("smart")).toBeTruthy();
  });
});

describe("the Signer's log events", () => {
  it("appends one line per event with a message and none for one without", () => {
    const { rerender } = render(panel(SESSION, widgetWith({ address: SMART_ACCOUNT })));
    rerender(panel(null, widgetWith()));
    const before = logLines();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("fluent:signer:log", {
          detail: { message: "signer created", details: { wallets: 1 } },
        }),
      );
      window.dispatchEvent(new CustomEvent("fluent:signer:log", { detail: { message: "plain" } }));
      window.dispatchEvent(new CustomEvent("fluent:signer:log", { detail: {} }));
    });

    // One listener after StrictMode's second pass: its cleanup removed the first one.
    expect(newLines(before)).toEqual([
      `${STAMP}  signer: signer created {"wallets":1}`,
      `${STAMP}  signer: plain`,
    ]);
  });

  it("stops listening on unmount", () => {
    const { unmount } = render(panel(SESSION, widgetWith()));
    const removed = vi.spyOn(window, "removeEventListener");

    unmount();

    expect(removed).toHaveBeenCalledWith("fluent:signer:log", expect.any(Function));
  });
});
