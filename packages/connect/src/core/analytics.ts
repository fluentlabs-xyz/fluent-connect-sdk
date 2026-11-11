// Type-only: erased at compile time, so the library stays out of the bundle and is
// fetched on demand in `initFluentAnalytics`.
import type { PostHog } from "posthog-js";
// Read straight from the manifest: the demo apps alias this package to `src`, so a
// build-time define would exist in dist and be undefined everywhere else.
import { version as SDK_VERSION } from "../../package.json";
import { FLUENT_CONNECT_POSTHOG_TOKEN, type ResolvedFluentWidgetConfig } from "./config";

const INSTANCE_NAME = "fluent";

/**
 * PostHog's own UI, not an endpoint we serve. posthog-js normally derives it from
 * `api_host` by swapping `.i.posthog.com` for `.posthog.com`, which is a no-op once
 * `api_host` points at our proxy — leaving replay and toolbar links aimed at `/ingest`.
 * The project lives in US Cloud, so this is a region constant rather than a setting.
 */
const POSTHOG_UI_HOST = "https://us.posthog.com";

/** Record our own portals only; everything else at body level belongs to the host page. */
const BLOCK_SELECTOR = 'body > *:not([data-slot="dialog-portal"]):not([data-slot="drawer-portal"])';

/** Identity that only exists once a session has been issued. */
export type FluentAnalyticsContext = {
  smart_account_address?: string;
  embedded_wallet_address?: string;
};

export type FluentAnalyticsSendOptions = {
  /** The page is going away — this event has to leave before the tab does. */
  unload?: boolean;
};

export type FluentAnalyticsTrack = {
  (
    eventName: string,
    properties?: Record<string, unknown>,
    options?: FluentAnalyticsSendOptions,
  ): void;
  /** False when analytics is off for this config, so every call is a no-op. */
  live?: boolean;
};

const UNLOAD_CAPTURE_OPTIONS = {
  transport: "sendBeacon",
  send_instantly: true,
} as const;

type QueuedEvent = {
  eventName: string;
  payload: Record<string, unknown>;
  unload: boolean;
};

let client: PostHog | null = null;
let loading: Promise<void> | null = null;
let loadFailed = false;
let pending: QueuedEvent[] = [];
let widgetLoadedTracked = false;

/** Resets the module's state, which otherwise lives for the whole page; for tests. */
export function resetFluentAnalytics() {
  client = null;
  loading = null;
  loadFailed = false;
  pending = [];
  widgetLoadedTracked = false;
}

/**
 * Reports whether this config reports at all, which is known without loading anything. The
 * proxy host is derived from the Network, like every other endpoint, so a testnet widget never
 * reports into the production project; an empty host means the Network has no proxy, and
 * analytics stays off.
 */
function analyticsEnabled(config: ResolvedFluentWidgetConfig) {
  return !config.disableAnalytics && Boolean(config.analyticsHost);
}

export function initFluentAnalytics(config: ResolvedFluentWidgetConfig): void {
  if (!analyticsEnabled(config) || loading) return;

  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      client = posthog.init(
        FLUENT_CONNECT_POSTHOG_TOKEN,
        {
          api_host: config.analyticsHost,
          ui_host: POSTHOG_UI_HOST,
          persistence: "localStorage",
          // The widget is a guest in the App's page: no automatic collection. Each option is set
          // explicitly, because the project's remote config turns performance capture, heatmaps
          // and console recording on, and leaving one out does not switch it off.
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          rageclick: false,
          capture_performance: false,
          capture_heatmaps: false,
          capture_dead_clicks: false,
          // Widget console logs carry session ids and wallet addresses.
          enable_recording_console_log: false,
          session_recording: { blockSelector: BLOCK_SELECTOR },
        },
        INSTANCE_NAME,
      );

      for (const queued of pending.splice(0)) {
        capture(queued.eventName, queued.payload, queued.unload);
      }
    })
    .catch(() => {
      // The chunk is served from the App's own bundle; if it will not load,
      // retrying tends to fail the same way. Stop queueing rather than grow forever.
      loadFailed = true;
      pending = [];
    });
}

/**
 * Returns `properties` with only their string, number, boolean and `null` values. An App wires
 * callbacks like `openConnect` straight to `onClick`, so a DOM event can arrive where a plain
 * value was expected; posthog-js cannot serialise one and would lose the whole event, so only
 * that property is dropped.
 */
function sanitise(properties?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!properties) return properties;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const type = typeof value;
    if (value === null || type === "string" || type === "number" || type === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Captures one event. The third argument is omitted rather than passed as `undefined`:
 * posthog-js skips its batch queue as soon as any options object is present, so the batched
 * path calls with exactly two arguments.
 */
function capture(eventName: string, payload: Record<string, unknown>, unload: boolean) {
  if (unload) {
    client?.capture(eventName, payload, UNLOAD_CAPTURE_OPTIONS);
    return;
  }
  client?.capture(eventName, payload);
}

function send(eventName: string, payload: Record<string, unknown>, unload: boolean) {
  if (client) {
    capture(eventName, payload, unload);
    return;
  }
  if (loadFailed) return;
  pending.push({ eventName, payload, unload });
}

export function createTracker(
  config: ResolvedFluentWidgetConfig,
  getContext?: () => FluentAnalyticsContext,
): FluentAnalyticsTrack {
  const enabled = analyticsEnabled(config);
  if (enabled) initFluentAnalytics(config);

  const base = {
    app_id: config.appId,
    network: config.network,
    source: config.source,
    campaign: config.campaign,
    sdk_version: SDK_VERSION,
  };

  const track: FluentAnalyticsTrack = (eventName, properties, options) => {
    if (!enabled) return;
    // Base and context go last, so a property named `app_id` cannot misattribute the event
    // (`sanitise` never looks at keys), and are read now: an event queued before login must not
    // gain the account's addresses when the module lands.
    const payload = { ...sanitise(properties), ...base, ...getContext?.() };
    // The unload path skips posthog-js's batch queue, which posthog-js drains from a `pagehide`
    // handler registered before any of the widget's: an event sent while unloading would land
    // in a queue already drained, and never leave.
    send(eventName, payload, Boolean(options?.unload));
  };

  track.live = enabled;
  return track;
}

/**
 * Tracks `widget_loaded` once per page: the funnel denominator must not depend on how many times
 * React mounts the widget, which StrictMode, HMR and remounts would each inflate.
 */
export function trackWidgetLoadedOnce(
  track: FluentAnalyticsTrack,
  properties?: Record<string, unknown>,
) {
  if (widgetLoadedTracked) return;
  track("widget_loaded", properties);
  // Spent only when the event could leave, judged by this tracker rather than the module's
  // client: neither a disabled widget beside a live one nor a widget on a Network with no proxy
  // may spend it for the page.
  if (track.live) widgetLoadedTracked = true;
}
