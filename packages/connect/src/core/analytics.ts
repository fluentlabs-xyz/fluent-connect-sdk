import posthog, { type PostHog } from "posthog-js";
// Read straight from the manifest: the demo apps alias this package to `src`, so a
// build-time define would exist in dist and be undefined everywhere else.
import { version as SDK_VERSION } from "../../package.json";
import {
  FLUENT_CONNECT_POSTHOG_TOKEN,
  type ResolvedFluentWidgetConfig,
} from "./config";

const INSTANCE_NAME = "fluent";

/**
 * PostHog's own UI, not an endpoint we serve. posthog-js normally derives it from
 * `api_host` by swapping `.i.posthog.com` for `.posthog.com`, which is a no-op once
 * `api_host` points at our proxy — leaving replay and toolbar links aimed at `/ingest`.
 * The project lives in US Cloud, so this is a region constant rather than a setting.
 */
const POSTHOG_UI_HOST = "https://us.posthog.com";

/** Record our own portals only; everything else at body level belongs to the host page. */
const BLOCK_SELECTOR =
  'body > *:not([data-slot="dialog-portal"]):not([data-slot="drawer-portal"])';

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

let client: PostHog | null = null;
let widgetLoadedTracked = false;

/** Test seam: both the instance and the once-per-page guard live for the whole page. */
export function resetFluentAnalytics() {
  client = null;
  widgetLoadedTracked = false;
}

export function initFluentAnalytics(
  config: ResolvedFluentWidgetConfig,
): PostHog | null {
  // The proxy host is resolved from the widget network, like every other endpoint,
  // so a testnet widget can never report into the production project. Empty means
  // the network has no proxy yet and analytics stays off.
  if (config.disableAnalytics || !config.analyticsHost) return null;
  if (client) return client;

  client =
    posthog.init(
      FLUENT_CONNECT_POSTHOG_TOKEN,
      {
        api_host: config.analyticsHost,
        ui_host: POSTHOG_UI_HOST,
        persistence: "localStorage",
        // The widget is a guest in someone else's page — no automatic collection.
        // Every one of these must be set explicitly: the project's remote config
        // turns performance capture, heatmaps and console recording ON, so leaving
        // an option out is not the same as switching it off.
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
    ) ?? null;

  return client;
}

/**
 * Host apps wire callbacks like `openConnect` straight to onClick, so a DOM event can
 * arrive where a plain value was expected. posthog-js cannot serialise one, and the
 * whole event is lost — drop the offending property instead of the event.
 */
function sanitise(
  properties?: Record<string, unknown>,
): Record<string, unknown> | undefined {
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

export function createTracker(
  config: ResolvedFluentWidgetConfig,
  getContext?: () => FluentAnalyticsContext,
): FluentAnalyticsTrack {
  const ph = initFluentAnalytics(config);
  const base = {
    client_id: config.clientId,
    network: config.network,
    auth_mode: config.authMode,
    source: config.source,
    campaign: config.campaign,
    sdk_version: SDK_VERSION,
  };

  const track: FluentAnalyticsTrack = (eventName, properties, options) => {
    // Base and context are spread last so they cannot be overwritten: `sanitise` filters
    // by value type and never looks at keys, so an event property named `client_id` or
    // `smart_account_address` would otherwise silently misattribute the event.
    const payload = { ...sanitise(properties), ...base, ...getContext?.() };
    // posthog-js batches captures on a 3s timer and drains the queue from its own
    // `pagehide` handler, registered during init — before any listener the widget adds.
    // An event emitted while unloading would land in the queue that was just drained
    // and never leave. Note the queue is skipped whenever an options object is passed
    // at all, so the normal path has to keep calling with exactly two arguments.
    if (options?.unload) {
      ph?.capture(eventName, payload, UNLOAD_CAPTURE_OPTIONS);
      return;
    }
    ph?.capture(eventName, payload);
  };

  track.live = ph !== null;
  return track;
}

/**
 * The funnel denominator must not depend on how many times React mounts the widget:
 * StrictMode, HMR and remounts would each inflate it.
 */
export function trackWidgetLoadedOnce(
  track: FluentAnalyticsTrack,
  properties?: Record<string, unknown>,
) {
  if (widgetLoadedTracked) return;
  track("widget_loaded", properties);
  // Spend the one shot only if it could actually leave, and judge that by the tracker
  // that was used rather than the module-global client: a disabled widget sharing the
  // page with a live one would otherwise burn the guard on its behalf. A widget mounted
  // on a network with no proxy must not leave the funnel denominator empty either.
  if (track.live) widgetLoadedTracked = true;
}
