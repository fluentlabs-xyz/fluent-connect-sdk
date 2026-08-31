import type { Address, Hex } from "viem";

import {
  CHAIN,
  DRY_RUN_MAX_COST_WEI,
  DRY_RUN_MAX_FEE_PER_GAS_WEI,
  PARTNER_CLIENT_ID,
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
 * `absent` is the case the whole panel hangs on: `/bench/decide` is not registered when
 * the service runs without `--bench-enabled`, so it 404s or does not answer at all, and
 * this app is then the public demo rather than the bench. `failed` is different and must
 * stay visible — the route exists and broke, which is a bug to read, not a mode to hide.
 */
export type BenchDecideResult =
  | { status: "ok"; decision: BenchDecision; raw: string }
  | { status: "absent"; message: string }
  | { status: "failed"; message: string; raw?: string };

export function selectorOf(data: Hex): string {
  // 4 bytes of selector, or nothing at all when the call carries no calldata.
  return data.length >= 10 ? data.slice(0, 10) : "";
}

export async function decide(params: {
  privyId: string;
  sender?: Address;
  calls: BenchCall[];
  signal?: AbortSignal;
}): Promise<BenchDecideResult> {
  const body = {
    client_id: PARTNER_CLIENT_ID,
    privy_id: params.privyId,
    // Omitted rather than faked when nobody is signed in: the service synthesises a
    // stable address per DID, and a made-up one here would split that person's counters.
    ...(params.sender ? { sender: params.sender } : {}),
    chain_id: CHAIN.id,
    calls: params.calls,
    max_cost_wei: DRY_RUN_MAX_COST_WEI,
    max_fee_per_gas_wei: DRY_RUN_MAX_FEE_PER_GAS_WEI,
    commit: false,
  };

  let response: Response;
  try {
    response = await fetch(`${SPONSORSHIP_URL.replace(/\/+$/, "")}/bench/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (error) {
    // A refused connection and a CORS rejection are both "did not answer".
    return {
      status: "absent",
      message: error instanceof Error ? error.message : "sponsorship service did not answer",
    };
  }

  const raw = await response.text();
  if (response.status === 404) {
    return { status: "absent", message: "/bench/decide is not registered (404)" };
  }
  if (!response.ok) {
    return { status: "failed", message: `HTTP ${response.status}`, raw };
  }

  try {
    return { status: "ok", decision: JSON.parse(raw) as BenchDecision, raw };
  } catch {
    return { status: "failed", message: "response was not JSON", raw };
  }
}

/**
 * The deployed twin of `/bench/decide`: `POST /paymaster/{client_id}/preview` runs the same
 * model evaluation for **the signed-in person only** — identity comes from the Privy token,
 * never the body, which is why this route may exist in a deployed environment while the
 * bench routes may not. No seeded people, no repaint; `engine` is left empty because the
 * preview does not report which evaluator a real send would meet.
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
      `${SPONSORSHIP_URL.replace(/\/+$/, "")}/paymaster/${encodeURIComponent(PARTNER_CLIENT_ID)}/preview`,
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
    return { status: "failed", message: `HTTP ${response.status}`, raw };
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
