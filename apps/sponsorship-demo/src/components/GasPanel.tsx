import type { FluentTokenBalance } from "@fluent.xyz/connect";

import { shortenHex } from "../bench/format";
import { describeGasPayer } from "../bench/gasOption";
import type { GasOptionAvailability } from "../bench/gasOption";
import type { GasOption, GasOptionId } from "../consts";

export type GasChoice = {
  option: GasOption;
  availability: GasOptionAvailability;
  balance: FluentTokenBalance | undefined;
};

/** A balance in the token's own decimals, short enough to sit inside a label. */
function shortBalance(balance: FluentTokenBalance | undefined) {
  if (!balance || balance.status !== "ready" || balance.formatted === null) return null;
  const [whole, frac = ""] = balance.formatted.split(".");
  return frac ? `${whole}.${frac.slice(0, 2)}` : whole;
}

/**
 * Who pays, chosen once for the whole page.
 *
 * It lives here rather than on each action because none of it is a property of an action:
 * the balance, the paymaster and the account kind are the same on every row, and printing
 * them per row is what made the first version of this page unreadable — the same four
 * sentences, four times.
 */
export function GasPanel({
  choices,
  selected,
  onSelect,
  approval,
  onRetryPaymaster,
  blockedForEveryone,
  accountType,
  dryRunReason,
}: {
  choices: readonly GasChoice[];
  selected: GasOptionId;
  /** `widget.account.type` — decides which account the gas actually leaves. */
  accountType: "smart" | "eoa" | undefined;
  onSelect: (id: GasOptionId) => void;
  /** The `approve` the selected token would prepend, or null when it prepends none. */
  approval: { call: string; reason: string } | null;
  /** Present only while the ERC-20 paymaster is unreachable. */
  onRetryPaymaster?: () => void;
  /**
   * One sentence standing in for every option's reason when nothing can be sent at all.
   * Without it a signed-out visitor reads "Sign in and wait…" three times over.
   */
  blockedForEveryone?: string;
  /**
   * Why Dry-run is off for this selection. Stated here rather than left to a tooltip on a
   * greyed button: a disabled control with an unstated reason teaches the visitor that the
   * product is broken, which is the one reading this page must never allow.
   */
  dryRunReason?: string;
}) {
  return (
    <section className="gas-panel">
      {/* A heading, not a chip: as a sibling of the buttons the word read as a fourth way
          to pay. */}
      <h2 className="gas-heading">Gas</h2>
      <div className="gas-row">
        {/* The account menu carries a gas selector of its own. It is not this one, and a
            reader who flips it and then sends here would otherwise get an unexplained
            result — the exact confusion this page exists to remove. */}

        {choices.map(({ option, availability, balance }) => {
          const amount = option.token ? shortBalance(balance) : null;
          return (
            <button
              key={option.id}
              type="button"
              className={option.id === selected ? "gas-choice gas-choice-on" : "gas-choice"}
              onClick={() => onSelect(option.id)}
              disabled={!availability.enabled}
              aria-pressed={option.id === selected}
              title={availability.reason}
            >
              {option.label}
              {amount ? <span className="gas-amount"> {amount}</span> : null}
            </button>
          );
        })}

        {onRetryPaymaster ? (
          <button type="button" className="link-button" onClick={onRetryPaymaster}>
            Ask the paymaster again
          </button>
        ) : null}
      </div>

      <p className="gas-payer">{describeGasPayer({ option: selected, accountType })}</p>

      {dryRunReason ? <p className="hint">{dryRunReason}</p> : null}

      <p className="hint gas-note">
        Chosen here, not in the account menu — this page pins the gas token on every send.
      </p>

      {blockedForEveryone ? (
        <p className="hint">{blockedForEveryone}</p>
      ) : (
        /* Only the reasons that are true right now, and only once each — a reason repeated
           per action is the thing this panel exists to stop. */
        choices
          .filter(({ availability }) => !availability.enabled)
          .map(({ option, availability }) => (
            <p className="hint" key={option.id}>
              <strong>{option.label}</strong> — {availability.reason}
            </p>
          ))
      )}

      {approval ? (
        <details className="approval">
          <summary>A {gasSummary(selected)} send adds an approve first</summary>
          <p className="mono row-call" title={approval.call}>
            {shortenHex(approval.call)}
          </p>
          <p className="hint">{approval.reason}</p>
        </details>
      ) : null}
    </section>
  );
}

function gasSummary(id: GasOptionId) {
  return id === "sponsored" || id === "self" ? id : `${id}-paid`;
}
