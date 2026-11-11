import { describe, expect, it, vi } from "vitest";

import { FLUENT_WIDGET_SESSION_STORAGE_KEY } from "../core/storageKeys";
import { hasStoredWidgetSession } from "./hasStoredWidgetSession";

describe("hasStoredWidgetSession", () => {
  it("reports a stored Widget session when its storage key holds one", () => {
    const storage = {
      getItem: vi.fn((key: string) =>
        key === FLUENT_WIDGET_SESSION_STORAGE_KEY ? '{"wallet":{}}' : null,
      ),
    };

    expect(hasStoredWidgetSession(storage)).toBe(true);
  });

  it("reports none when its storage key is empty", () => {
    expect(hasStoredWidgetSession({ getItem: () => null })).toBe(false);
  });
});
