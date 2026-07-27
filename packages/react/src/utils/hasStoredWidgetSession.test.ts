import { describe, expect, it, vi } from "vitest";

import { FLUENT_WIDGET_SESSION_STORAGE_KEY } from "../storageKeys";
import { hasStoredWidgetSession } from "./hasStoredWidgetSession";

describe("hasStoredWidgetSession", () => {
  it("enables session signing when the widget authorization is stored", () => {
    const storage = {
      getItem: vi.fn((key: string) =>
        key === FLUENT_WIDGET_SESSION_STORAGE_KEY ? "{\"wallet\":{}}" : null
      ),
    };

    expect(hasStoredWidgetSession(storage)).toBe(true);
  });

  it("keeps prompted signing when no widget authorization is stored", () => {
    expect(hasStoredWidgetSession({ getItem: () => null })).toBe(false);
  });
});
