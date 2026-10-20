import { describe, expect, it } from "vitest";
import { zeroAddress, type Address } from "viem";

import { badgeFor, classifyPayer, payerSentence } from "./PayerBadge";

/*
 * The dev Network's two sponsorship paymasters, as `consts.ts` holds them, written here in mixed
 * case: the EntryPoint event decodes to a checksummed address, and the bench compares lowercased.
 */
const OWN_PAYMASTER = "0xC1f36bF0b66f8Ac4Ac8a7477378FE9c718C57C56" as Address;
const ZERODEV_PAYMASTER = "0x991E4158E338283D7EFbC37eb49491A21434D964" as Address;
const ERC20_PAYMASTER = "0x1111111111111111111111111111111111111111" as Address;
const SOMEBODY_ELSE = "0x2222222222222222222222222222222222222222" as Address;

describe("classifyPayer", () => {
  it("names Fluent's own paymaster as the App's budget through it", () => {
    expect(classifyPayer(OWN_PAYMASTER, ERC20_PAYMASTER)).toBe("app-budget-own");
  });

  it("names ZeroDev's paymaster as the App's budget through it", () => {
    expect(classifyPayer(ZERODEV_PAYMASTER, ERC20_PAYMASTER)).toBe("app-budget-zerodev");
  });

  it("reads the zero address as the account paying its own gas", () => {
    expect(classifyPayer(zeroAddress, ERC20_PAYMASTER)).toBe("user-eth");
  });

  it("still names the ERC-20 paymaster the SDK resolved as the user paying in a token", () => {
    expect(classifyPayer(ERC20_PAYMASTER, ERC20_PAYMASTER)).toBe("user-token");
  });

  it("keeps an address it does not know as unrecognised rather than guessing", () => {
    expect(classifyPayer(SOMEBODY_ELSE, ERC20_PAYMASTER)).toBe("unrecognised");
    expect(classifyPayer(SOMEBODY_ELSE, undefined)).toBe("unrecognised");
  });

  it("reports a paymaster it could not read as unreadable, never as a payer", () => {
    expect(classifyPayer(undefined, ERC20_PAYMASTER)).toBe("unreadable");
  });
});

describe("badgeFor", () => {
  it("says which sponsorship paymaster paid, both in the sponsored style", () => {
    expect(badgeFor("app-budget-own")).toEqual({
      label: "SPONSORED · FLUENT",
      className: "badge badge-sponsored",
    });
    expect(badgeFor("app-budget-zerodev")).toEqual({
      label: "SPONSORED · ZERODEV",
      className: "badge badge-sponsored",
    });
  });

  it("keeps the self-paid badge in its own style", () => {
    expect(badgeFor("user-eth")).toEqual({ label: "PAID OWN GAS", className: "badge badge-self" });
  });

  it("gives neither unknown answer the sponsored colour", () => {
    expect(badgeFor("unrecognised").className).toBe("badge badge-unknown");
    expect(badgeFor("unreadable").className).toBe("badge badge-unknown");
  });
});

describe("payerSentence", () => {
  it("names the sponsorship paymaster that paid", () => {
    expect(payerSentence({ payer: "app-budget-own", requested: "sponsored" })).toBe(
      "The App's budget paid, through Fluent's own paymaster.",
    );
    expect(payerSentence({ payer: "app-budget-zerodev", requested: "sponsored" })).toBe(
      "The App's budget paid, through ZeroDev's paymaster.",
    );
  });

  it("names the paymaster and the disagreement when sponsorship was not asked for", () => {
    expect(payerSentence({ payer: "app-budget-own", requested: "BLEND" })).toBe(
      "The App's budget paid, through Fluent's own paymaster, though the send asked for BLEND.",
    );
  });

  it("says a self-paid sponsored send was refused or never sponsored, naming the dry-run", () => {
    const sentence = payerSentence({ payer: "user-eth", requested: "sponsored" });
    expect(sentence).toContain("your account paid its own ETH");
    expect(sentence).toContain("dry-run");
  });

  it("has nothing to say before the send settles", () => {
    expect(payerSentence({ requested: "sponsored" })).toBeNull();
  });
});
