/**
 * Invariant (2) of FLU-1639, for generated stored sessions: `toFluentWidgetSession`, the one
 * projection every host boundary goes through (ADR 0005), hands a host exactly
 * `{ account: { address, type }, issuedAt }` or `null`, and no string from the stored session's
 * other fields appears in it. Those fields carry the login's identity token and, before 0.6.0,
 * a session private key. Values of any type sit in them, since a stored session is read back
 * from storage a script on the page can write.
 *
 * Every string the generator puts anywhere but a valid address, as a value or as a key at any
 * depth, starts with a marker, so a leak of any of them is found by substring; a malformed
 * address or `issuedAt` carries the marker too. The first
 * property holds the projection to that shape for any input; the second holds that a session
 * with a valid address and `issuedAt` is projected, not refused, so the first cannot pass by
 * answering `null` to everything. Nothing is faked.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bytesToHex, getAddress } from "viem";

import { toFluentWidgetSession, type FluentStoredSession } from "./config";

/** Starts every string the projection must not carry, so a leak is found by substring. */
const SECRET = "secret:";

const secretString = fc.string().map((text) => `${SECRET}${text}`);

/** Any value whose every string, as a leaf or as a key, carries the marker. */
const secretAnything = fc.anything({
  key: secretString,
  values: [
    secretString,
    fc.integer(),
    fc.double(),
    fc.boolean(),
    fc.bigInt(),
    fc.constant(null),
    fc.constant(undefined),
  ],
  withNullPrototype: true,
  withBoxedValues: true,
  withMap: true,
  withSet: true,
});

/** What a stored session's other fields hold: secrets, structures of secrets, or anything. */
const otherField = fc.oneof(
  secretString,
  fc.array(secretString),
  fc.dictionary(secretString, secretString),
  fc.record({
    expiresAt: fc.integer(),
    serializedPermissionAccount: secretString,
    sessionPrivateKey: secretString,
    signerAddress: secretString,
  }),
  secretAnything,
);

/** Extra keys a stored object may carry beyond its type, none of them `__proto__`. */
const extraFields = fc.dictionary(secretString, otherField);

const validAddress = fc.oneof(
  fc.uint8Array({ minLength: 20, maxLength: 20 }).map((bytes) => bytesToHex(bytes)),
  fc.uint8Array({ minLength: 20, maxLength: 20 }).map((bytes) => getAddress(bytesToHex(bytes))),
);

const validIssuedAt = fc.oneof(
  fc.integer({ min: 0 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
);

/** A stored session around the given address and `issuedAt`, every other field generated. */
const storedSession = (address: fc.Arbitrary<unknown>, issuedAt: fc.Arbitrary<unknown>) =>
  fc
    .tuple(
      fc.record({
        app: otherField,
        user: otherField,
        scopes: otherField,
        appId: otherField,
        idToken: otherField,
        expiresAt: otherField,
        metadata: otherField,
        issuedAt,
      }),
      fc.record({
        smartAccountAddress: address,
        signerAddress: otherField,
        authorizationSession: otherField,
      }),
      extraFields,
      extraFields,
    )
    .map(([fields, wallet, extra, walletExtra]) => ({
      ...extra,
      ...fields,
      wallet: { ...walletExtra, ...wallet },
    }));

/** Any stored session: `null`, a well-formed one, or one with any address and `issuedAt`. */
const anyStoredSession = fc.oneof(
  { arbitrary: fc.constant(null), weight: 1 },
  { arbitrary: storedSession(validAddress, validIssuedAt), weight: 10 },
  {
    weight: 10,
    arbitrary: storedSession(
      fc.oneof(validAddress, secretString, secretAnything),
      fc.oneof(
        validIssuedAt,
        fc.constantFrom(NaN, Infinity, -Infinity),
        secretString,
        secretAnything,
      ),
    ),
  },
);

describe("invariant (2): a stored session projects to the Widget session's fields only", () => {
  it("copies only the address, the type and issuedAt from any stored session", () => {
    fc.assert(
      fc.property(anyStoredSession, (generated) => {
        const stored = generated as unknown as FluentStoredSession | null;
        const projected = toFluentWidgetSession(stored);
        if (projected === null) return;

        expect(typeof projected.account.address).toBe("string");
        expect(Number.isFinite(projected.issuedAt)).toBe(true);
        expect(projected).toStrictEqual({
          account: { address: stored?.wallet.smartAccountAddress, type: "smart" },
          issuedAt: stored?.issuedAt,
        });
        expect(JSON.stringify(projected)).not.toContain(SECRET);
      }),
      { numRuns: 500 },
    );
  });

  it("projects every stored session whose address and issuedAt are valid", () => {
    fc.assert(
      fc.property(storedSession(validAddress, validIssuedAt), (generated) => {
        const stored = generated as unknown as FluentStoredSession;
        expect(toFluentWidgetSession(stored)).toStrictEqual({
          account: { address: stored.wallet.smartAccountAddress, type: "smart" },
          issuedAt: stored.issuedAt,
        });
      }),
    );
  });
});
