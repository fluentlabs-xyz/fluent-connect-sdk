import { describe, expect, it } from "vitest";

import { buildFluentBridgeUrl } from "./buildFluentBridgeUrl";

describe("buildFluentBridgeUrl", () => {
  it("appends recipient to the portal bridge path", () => {
    expect(
      buildFluentBridgeUrl(
        "https://portal.fluent.xyz/user/bridge",
        "0xabc123",
      ),
    ).toBe("https://portal.fluent.xyz/user/bridge?recipient=0xabc123");
  });

  it("preserves existing query params", () => {
    expect(
      buildFluentBridgeUrl(
        "https://portal.fluent.xyz/user/bridge?foo=1",
        "0xabc123",
      ),
    ).toBe("https://portal.fluent.xyz/user/bridge?foo=1&recipient=0xabc123");
  });

  it("returns the base url when recipient is missing", () => {
    expect(buildFluentBridgeUrl("https://portal.fluent.xyz/user/bridge")).toBe(
      "https://portal.fluent.xyz/user/bridge",
    );
  });
});
