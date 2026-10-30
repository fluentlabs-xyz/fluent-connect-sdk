// The declarations the census fixture entry (./index.ts) reaches without exporting them: each
// one is reachable from an export of the entry only through an inferred type, a `typeof`, an
// un-annotated const, an import type or a module augmentation, the shapes the census once missed
// (FLU-1622 audit findings S7 and S8). The seam case at the end is the exception: the entry
// exports `SeamAdapter` and `SeamHost` by name. The helpers are `declare`d because the census
// reads types only; nothing runs this file.
import type { Register, UseQueryResult } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import type { Chain } from "viem";

/** Reached only as the argument of React's `Dispatch<SetStateAction<…>>`. */
export interface AliasArgument {
  alias: true;
}

/** Reached only through deferred conditional types. */
export interface ConditionalExtends {
  extendsSide: true;
}
export interface ConditionalTrue {
  trueSide: true;
}
export interface ConditionalFalse {
  falseSide: true;
}

/** Reached only as the object side of a deferred indexed access. */
export interface IndexedHost {
  first: string;
  second: number;
}

/** Reached only inside a deferred `keyof`. */
export interface KeyofHost {
  keyed: true;
}

/** Reached only inside a placeholder of a template literal type. */
export interface TemplateBrand {
  brand: true;
}

/** Reached only as the constraint of an instantiated type parameter. */
export interface ConstraintArgument {
  constrained: true;
}

/** Reached only as the default of an instantiated type parameter. */
export interface DefaultArgument {
  defaulted: true;
}

/** Reached only through `typeof`. */
export const internalValue = { internal: true };

/**
 * Reached only through a parameter annotation of an arrow an un-annotated const wraps; as an
 * optional parameter it is flattened into `"fast" | "slow" | undefined`.
 */
export type ArrowMode = "fast" | "slow";

/** Flattened into a union, so only the syntax of the initializer that names it reaches it. */
export type FlatMode = "first" | "second";

export declare const constraintSeed: ConstraintArgument;
export declare const defaultSeed: DefaultArgument;

export declare function aliasHelper(): Dispatch<SetStateAction<AliasArgument>>;
export declare function vendorHelper(): UseQueryResult<Chain>;
export declare function conditionalHelper<T>(
  value: T,
): T extends ConditionalExtends ? ConditionalTrue : ConditionalFalse;
export declare function indexedHelper<K extends string>(
  key: K,
): IndexedHost[K & keyof IndexedHost];
export declare function keyofHelper<T>(value: T): keyof (T extends string ? KeyofHost : never);
export declare function templateHelper<T extends string>(value: T): `${T & TemplateBrand}`;
export declare function constraintHelper<C>(seed: C): <T extends C>(value: T) => T;
export declare function defaultHelper<D>(seed: D): <T = D>(value?: T) => T | undefined;
/** A higher-order wrapper: the function it returns is its own, not the arrow it was given. */
export declare function wrapHelper<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R;

/** Reached only through an import type, so only the syntax names it, as with `FlatMode`. */
export type ImportMode = "near" | "far";

/** Reached only through the member a module augmentation adds to a vendor's interface. */
export interface AugmentArgument {
  augmented: true;
}

declare module "@tanstack/react-query" {
  interface Register {
    censusFixture: AugmentArgument;
  }
}

export declare function augmentHelper(): Register;

/** The fixture's seam type: exported by the entry, it reaches a vendor of its own. */
export interface SeamAdapter {
  query: UseQueryResult<SeamPayload>;
}

/** Reached only through the seam type, which the opaque member's walk does not enter. */
export interface SeamPayload {
  payload: true;
}

/** `adapter` is the opaque member, its annotation widened past the seam type to a vendor's. */
export interface SeamHost {
  adapter?: SeamAdapter | Chain;
}
