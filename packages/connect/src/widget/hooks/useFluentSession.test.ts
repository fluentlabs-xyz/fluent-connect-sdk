/**
 * @vitest-environment jsdom
 *
 * `useFluentSession` as it behaves today: the stored session it restores on mount, how often it
 * reports a session to analytics and to `onSessionChange`, and what it writes to storage.
 *
 * Fakes: browser storage, jsdom's `localStorage`.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FLUENT_WIDGET_SESSION_STORAGE_KEY, type FluentStoredSession } from "../../core/config";
import { useFluentSession } from "./useFluentSession";

type Props = Parameters<typeof useFluentSession>[0];

function storedSession(smartAccountAddress: `0x${string}`, issuedAt: number): FluentStoredSession {
  return {
    app: { mode: "origin", origin: "http://localhost", installationId: "installation" },
    user: { id: "did:privy:someone" },
    wallet: { smartAccountAddress },
    scopes: [],
    issuedAt,
    idToken: "id-token",
  };
}

const STORED = storedSession("0x1111111111111111111111111111111111111111", 1_700_000_000);
const NEXT = storedSession("0x2222222222222222222222222222222222222222", 1_700_000_100);

function renderSession(initialProps: Props) {
  return renderHook((props: Props) => useFluentSession(props), {
    initialProps,
    wrapper: StrictMode,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useFluentSession", () => {
  it("reports the restored session on mount and not again when the reporter or session changes", () => {
    window.localStorage.setItem(FLUENT_WIDGET_SESSION_STORAGE_KEY, JSON.stringify(STORED));
    const firstReport = vi.fn();
    const { result, rerender } = renderSession({ reportAnalyticsSession: firstReport });

    expect(result.current.session).toEqual(STORED);
    // StrictMode mounts the effect twice, and each mount reports the restored session.
    expect(firstReport.mock.calls).toEqual([[STORED], [STORED]]);

    rerender({ reportAnalyticsSession: firstReport });
    expect(firstReport).toHaveBeenCalledTimes(2);

    const secondReport = vi.fn();
    rerender({ reportAnalyticsSession: secondReport });
    // Pins current behaviour: a new reporter is not handed the session that is already there.
    expect(secondReport).not.toHaveBeenCalled();

    act(() => result.current.setSession(NEXT));
    expect(result.current.session).toEqual(NEXT);
    expect(secondReport.mock.calls).toEqual([[NEXT]]);
    // Pins current behaviour: the mount effect does not run again when the session changes.
    expect(firstReport).toHaveBeenCalledTimes(2);
  });

  it("reports no session on mount when storage holds none", () => {
    const report = vi.fn();
    const { result } = renderSession({ reportAnalyticsSession: report });

    expect(result.current.session).toBeNull();
    expect(report.mock.calls).toEqual([[null], [null]]);
  });

  it("hands each setSession to the latest reporter and onSessionChange, and writes storage", () => {
    const report = vi.fn();
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    const { result, rerender } = renderSession({
      reportAnalyticsSession: report,
      onSessionChange: firstChange,
    });
    const mountedSetSession = result.current.setSession;
    report.mockClear();

    rerender({ reportAnalyticsSession: report, onSessionChange: firstChange });
    expect(result.current.setSession).toBe(mountedSetSession);

    rerender({ reportAnalyticsSession: report, onSessionChange: secondChange });
    expect(result.current.setSession).not.toBe(mountedSetSession);

    act(() => result.current.setSession(NEXT));
    expect(report.mock.calls).toEqual([[NEXT]]);
    expect(firstChange).not.toHaveBeenCalled();
    expect(secondChange.mock.calls).toEqual([
      [
        {
          account: { address: NEXT.wallet.smartAccountAddress, type: "smart" },
          issuedAt: NEXT.issuedAt,
        },
      ],
    ]);
    expect(
      JSON.parse(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY) ?? "null"),
    ).toEqual(NEXT);

    act(() => result.current.setSession(null));
    expect(report.mock.calls).toEqual([[NEXT], [null]]);
    expect(secondChange.mock.calls[1]).toEqual([null]);
    expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY)).toBeNull();
    expect(result.current.session).toBeNull();
  });
});
