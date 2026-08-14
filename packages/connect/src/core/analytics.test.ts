import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFluentWidgetConfig } from "./config";

type InitOptions = {
  api_host: string;
  persistence: string;
  autocapture: boolean;
  capture_pageview: boolean;
  capture_pageleave: boolean;
  rageclick: boolean;
  capture_performance: boolean;
  capture_heatmaps: boolean;
  capture_dead_clicks: boolean;
  enable_recording_console_log: boolean;
  session_recording: { blockSelector: string };
};

const capture = vi.fn();
const init = vi.fn((_token: string, _options: InitOptions, _name?: string) => ({
  capture,
}));

vi.mock("posthog-js", () => ({ default: { init } }));

function firstInitCall() {
  const call = init.mock.calls[0];
  if (!call) throw new Error("posthog.init was never called");
  return call;
}

function firstCaptureCall() {
  const call = capture.mock.calls[0];
  if (!call) throw new Error("capture was never called");
  return call;
}

async function loadAnalytics() {
  const module = await import("./analytics");
  module.resetFluentAnalytics();
  return module;
}

beforeEach(() => {
  init.mockClear();
  capture.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

describe("initFluentAnalytics", () => {
  it("does not initialise when the network has no proxy host", async () => {
    const { initFluentAnalytics } = await loadAnalytics();
    const config = resolveFluentWidgetConfig({ clientId: "demo_app" });

    const client = initFluentAnalytics({ ...config, analyticsHost: "" });

    expect(client).toBeNull();
    expect(init).not.toHaveBeenCalled();
  });

  it("points api_host at the network's proxy", async () => {
    const { initFluentAnalytics } = await loadAnalytics();
    const config = resolveFluentWidgetConfig({ clientId: "demo_app" });

    initFluentAnalytics(config);

    expect(firstInitCall()[1]).toMatchObject({ api_host: config.analyticsHost });
    expect(config.analyticsHost).toContain("/ingest");
  });

  it("keeps ui_host on PostHog itself rather than letting it follow the proxy", async () => {
    const { initFluentAnalytics } = await loadAnalytics();
    const config = resolveFluentWidgetConfig({ clientId: "demo_app" });

    initFluentAnalytics(config);

    // Omitting this leaves replay and toolbar links pointing at /ingest: posthog-js
    // derives ui_host from api_host by a swap that no longer matches once api_host is
    // a proxy.
    expect(firstInitCall()[1]).toMatchObject({ ui_host: "https://us.posthog.com" });
  });

  it("does not initialise when disableAnalytics is set", async () => {
    const { initFluentAnalytics } = await loadAnalytics();

    const client = initFluentAnalytics(
      resolveFluentWidgetConfig({ clientId: "demo_app", disableAnalytics: true }),
    );

    expect(client).toBeNull();
    expect(init).not.toHaveBeenCalled();
  });

  it("turns off every automatic collector", async () => {
    const { initFluentAnalytics } = await loadAnalytics();

    initFluentAnalytics(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    const options = firstInitCall()[1];
    expect(options.autocapture).toBe(false);
    expect(options.capture_pageview).toBe(false);
    expect(options.capture_pageleave).toBe(false);
    expect(options.rageclick).toBe(false);
    expect(options.capture_performance).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.capture_dead_clicks).toBe(false);
    expect(options.enable_recording_console_log).toBe(false);
  });

  it("records only the widget portals and keeps storage out of cookies", async () => {
    const { initFluentAnalytics } = await loadAnalytics();

    initFluentAnalytics(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    const options = firstInitCall()[1];
    expect(options.persistence).toBe("localStorage");
    expect(options.session_recording.blockSelector).toBe(
      'body > *:not([data-slot="dialog-portal"]):not([data-slot="drawer-portal"])',
    );
  });

  it("uses a named instance so it cannot collide with the host page", async () => {
    const { initFluentAnalytics } = await loadAnalytics();

    initFluentAnalytics(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    expect(firstInitCall()[2]).toBe("fluent");
  });

  it("reports into the widget's own project", async () => {
    const { initFluentAnalytics } = await loadAnalytics();

    initFluentAnalytics(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    // Pinned as a literal on purpose: re-importing the constant would assert nothing,
    // and swapping this token silently redirects widget traffic into another project.
    expect(firstInitCall()[0]).toBe("phc_xr3QqFLEnKbDvmD5qsKvXuyaAdSkSKvcFGUH5VeDTLGD");
  });

  it("initialises once and hands back the same client", async () => {
    const { initFluentAnalytics } = await loadAnalytics();
    const config = resolveFluentWidgetConfig({ clientId: "demo_app" });

    const first = initFluentAnalytics(config);
    const second = initFluentAnalytics(config);

    expect(init).toHaveBeenCalledTimes(1);
    // Returning null on the second call would make every tracker after the first a
    // silent no-op — createTracker calls this on each construction.
    expect(second).toBe(first);
    expect(second).not.toBeNull();
  });
});

describe("createTracker", () => {
  it("merges the base properties into every event", async () => {
    const { createTracker } = await loadAnalytics();

    const track = createTracker(
      resolveFluentWidgetConfig({
        clientId: "demo_app",
        campaign: "launch",
        authMode: "direct",
      }),
    );
    track("connect_opened", { trigger: "connect_button" });

    expect(capture).toHaveBeenCalledWith("connect_opened", {
      client_id: "demo_app",
      network: expect.any(String),
      auth_mode: "direct",
      source: "fluent_connect_widget",
      campaign: "launch",
      sdk_version: expect.any(String),
      trigger: "connect_button",
    });
  });

  it("stays silent when analytics is disabled", async () => {
    const { createTracker } = await loadAnalytics();

    createTracker(resolveFluentWidgetConfig({ clientId: "demo_app", disableAnalytics: true }))("widget_loaded");

    expect(capture).not.toHaveBeenCalled();
  });

  it("adds the session addresses once they exist, and not before", async () => {
    const { createTracker } = await loadAnalytics();
    let context: Record<string, string> = {};

    const track = createTracker(resolveFluentWidgetConfig({ clientId: "demo_app" }), () => context);

    track("connect_opened");
    expect(firstCaptureCall()[1]).not.toHaveProperty("smart_account_address");

    context = { smart_account_address: "0xsmart", embedded_wallet_address: "0xsigner" };
    track("connect_login_completed");

    expect(capture.mock.calls[1]?.[1]).toMatchObject({
      smart_account_address: "0xsmart",
      embedded_wallet_address: "0xsigner",
    });
  });
});

describe("createTracker delivery", () => {
  it("leaves the normal path batched by passing no capture options", async () => {
    const { createTracker } = await loadAnalytics();
    const track = createTracker(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    track("connect_opened");

    // posthog-js skips its batch queue as soon as any options object is present, so a
    // third argument here would send every event immediately.
    expect(firstCaptureCall()).toHaveLength(2);
  });

  it("beacons an unload event out instead of queueing it", async () => {
    const { createTracker } = await loadAnalytics();
    const track = createTracker(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    track("wallet_tab_viewed", { tab: "home", dwell_ms: 1200 }, { unload: true });

    expect(firstCaptureCall()[2]).toEqual({
      transport: "sendBeacon",
      send_instantly: true,
    });
  });
});

describe("createTracker property hygiene", () => {
  it("drops properties that cannot be serialised, without losing the event", async () => {
    const { createTracker } = await loadAnalytics();
    const track = createTracker(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    const circular: Record<string, unknown> = { nativeEvent: {} };
    circular.self = circular;
    track("connect_opened", { trigger: circular });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(firstCaptureCall()[1]).toMatchObject({ client_id: "demo_app" });
    expect(firstCaptureCall()[1]).not.toHaveProperty("trigger");
  });

  it("carries every primitive the catalogue relies on", async () => {
    const { createTracker } = await loadAnalytics();
    const track = createTracker(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    // Each of these backs a real catalogued property: dwell_ms and chain_id are numbers,
    // has_stored_session and enabled are booleans, tab and label are strings. Dropping a
    // type from the allow-list would silently gut those events rather than break a build.
    track("wallet_tab_viewed", {
      tab: "home",
      dwell_ms: 1200,
      enabled: false,
      absent: null,
    });

    expect(firstCaptureCall()[1]).toMatchObject({
      tab: "home",
      dwell_ms: 1200,
      enabled: false,
      absent: null,
    });
  });

  it("does not let a caller overwrite the attribution", async () => {
    const { createTracker } = await loadAnalytics();
    const track = createTracker(
      resolveFluentWidgetConfig({ clientId: "demo_app" }),
      () => ({ smart_account_address: "0xreal" }),
    );

    track("connect_opened", {
      client_id: "someone_else",
      smart_account_address: "0xspoofed",
      sdk_version: "9.9.9",
    });

    expect(firstCaptureCall()[1]).toMatchObject({
      client_id: "demo_app",
      smart_account_address: "0xreal",
    });
    expect(firstCaptureCall()[1]?.sdk_version).not.toBe("9.9.9");
  });

  it("drops non-primitives and undefined rather than the event", async () => {
    const { createTracker } = await loadAnalytics();
    const track = createTracker(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    track("connect_external_wallet_connected", {
      chain_id: undefined,
      meta: { nested: true },
      list: [1, 2],
      when: new Date(0),
    });

    const properties = firstCaptureCall()[1];
    expect(properties).not.toHaveProperty("chain_id");
    expect(properties).not.toHaveProperty("meta");
    expect(properties).not.toHaveProperty("list");
    expect(properties).not.toHaveProperty("when");
    expect(properties).toMatchObject({ client_id: "demo_app" });
  });
});

describe("trackWidgetLoadedOnce", () => {
  it("emits once no matter how often the widget mounts", async () => {
    const { createTracker, trackWidgetLoadedOnce } = await loadAnalytics();
    const track = createTracker(resolveFluentWidgetConfig({ clientId: "demo_app" }));

    trackWidgetLoadedOnce(track, { has_stored_session: true });
    trackWidgetLoadedOnce(track, { has_stored_session: true });
    trackWidgetLoadedOnce(track, { has_stored_session: true });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(firstCaptureCall()[0]).toBe("widget_loaded");
    // has_stored_session splits returning visitors from new ones on the funnel's
    // denominator; forgetting to forward the properties would leave it undetectable.
    expect(firstCaptureCall()[1]).toMatchObject({ has_stored_session: true });
  });

  it("keeps its one shot when analytics was not live at mount", async () => {
    const { createTracker, trackWidgetLoadedOnce } = await loadAnalytics();
    const config = resolveFluentWidgetConfig({ clientId: "demo_app" });

    // Mainnet ships with no proxy host, so a widget can genuinely mount dead and be
    // switched to a live network later. Burning the guard there would zero the funnel
    // denominator while every other event kept flowing.
    // Judged by the tracker that was used, not by whether any client exists: a disabled
    // widget sharing the page with a live one must not burn the guard on its behalf.
    const dead = createTracker({ ...config, analyticsHost: "" });
    expect(dead.live).toBe(false);
    expect(createTracker(config).live).toBe(true);

    trackWidgetLoadedOnce(dead);
    expect(capture).not.toHaveBeenCalled();

    trackWidgetLoadedOnce(createTracker(config), { has_stored_session: false });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(firstCaptureCall()[0]).toBe("widget_loaded");
  });

  it("stays silent for a second tracker on the same page", async () => {
    const { createTracker, trackWidgetLoadedOnce } = await loadAnalytics();
    const config = resolveFluentWidgetConfig({ clientId: "demo_app" });

    // A host passing an inline config object re-creates the tracker on every render;
    // the guard has to be per page, not per tracker.
    trackWidgetLoadedOnce(createTracker(config), { has_stored_session: false });
    trackWidgetLoadedOnce(createTracker(config), { has_stored_session: false });

    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe("network endpoints", () => {
  it("keeps analytics off on mainnet until its proxy exists", async () => {
    await loadAnalytics();

    // Mainnet has no /ingest route yet: a real host here would make every production
    // widget POST into a 404. Empty is the documented "disabled" value.
    expect(resolveFluentWidgetConfig({ clientId: "demo_app", network: "mainnet" }).analyticsHost).toBe("");
    expect(resolveFluentWidgetConfig({ clientId: "demo_app", network: "testnet" }).analyticsHost).toContain("/ingest");
  });
});
