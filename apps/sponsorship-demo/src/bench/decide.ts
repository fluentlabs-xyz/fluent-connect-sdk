import type { Address, Hex } from "viem";

import {
  CHAIN,
  DRY_RUN_MAX_COST_WEI,
  DRY_RUN_MAX_FEE_PER_GAS_WEI,
  PARTNER_ID,
  SPONSORSHIP_URL,
} from "../consts";

/** One call as the evaluator sees it: where it went and which method it asked for. */
export type BenchCall = {
  target: string;
  selector: string;
};

/** The response shape frozen in the task contract. Rendered as-is; nothing is remapped. */
export type BenchDecision = {
  proceed: boolean;
  reason: string;
  detail: string;
  decided_by: string;
  segments: string[] | null;
  balance_wei: string;
  would_leave_wei: string;
  committed: boolean;
  hold_id: string | null;
  engine: string;
};

/**
 * `absent` — the service (or the route) did not answer at all; `failed` — it answered and
 * broke, which is a fault to read rather than a mode to hide.
 */
export type BenchDecideResult =
  | { status: "ok"; decision: BenchDecision; raw: string }
  | { status: "absent"; message: string }
  | { status: "failed"; message: string; raw?: string };

export function selectorOf(data: Hex): string {
  // 4 bytes of selector, or nothing at all when the call carries no calldata.
  return data.length >= 10 ? data.slice(0, 10) : "";
}

/**
 * `POST /paymaster/{partner_id}/preview` — the deployed dry-run. It answers for the
 * signed-in person only: identity comes from the Privy token, never the body. `engine` is
 * left empty because preview does not report which evaluator a real send would meet.
 */
export async function preview(params: {
  accessToken: string;
  calls: BenchCall[];
  signal?: AbortSignal;
}): Promise<BenchDecideResult> {
  const body = {
    chain_id: CHAIN.id,
    calls: params.calls,
    max_cost_wei: DRY_RUN_MAX_COST_WEI,
    max_fee_per_gas_wei: DRY_RUN_MAX_FEE_PER_GAS_WEI,
  };

  let response: Response;
  try {
    response = await fetch(
      `${SPONSORSHIP_URL.replace(/\/+$/, "")}/paymaster/${encodeURIComponent(PARTNER_ID)}/preview`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    );
  } catch (error) {
    return {
      status: "absent",
      message: error instanceof Error ? error.message : "sponsorship service did not answer",
    };
  }

  const raw = await response.text();
  if (response.status === 404) {
    return { status: "absent", message: "/preview is not registered (404)" };
  }
  if (!response.ok) {
    // The gate answers in plain text ("origin not allowed", "partner disabled") — that
    // sentence is the diagnosis, so it belongs on the page, not in a tooltip.
    const reason = raw.trim().slice(0, 120);
    return {
      status: "failed",
      message: reason ? `HTTP ${response.status} — ${reason}` : `HTTP ${response.status}`,
      raw,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Omit<BenchDecision, "committed" | "hold_id" | "engine">;
    return {
      status: "ok",
      decision: { ...parsed, committed: false, hold_id: null, engine: "" },
      raw,
    };
  } catch {
    return { status: "failed", message: "response was not JSON", raw };
  }
}
