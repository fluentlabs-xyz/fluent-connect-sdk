// The census fixture entry (FLU-1622 audit findings S7 and S8): closure.test.ts runs
// `apiCensus` over this file in place of `src/index.ts`. Each export is left un-annotated on
// purpose, so the declaration of ./internal.ts it reaches is visible only to a census that
// follows inferred types and initializers; each such declaration must show up in the export's
// `closure` with `exportedAs: null`. Nothing imports this file at runtime.
import {
  aliasHelper,
  augmentHelper,
  conditionalHelper,
  constraintHelper,
  constraintSeed,
  defaultHelper,
  defaultSeed,
  indexedHelper,
  type ArrowMode,
  type FlatMode,
  type internalValue,
  keyofHelper,
  templateHelper,
  vendorHelper,
  wrapHelper,
} from "./internal";

export const externalAlias = () => aliasHelper();
export const vendorAlias = () => vendorHelper();
export const conditional = <T>(value: T) => conditionalHelper(value);
export const indexedAccess = <K extends string>(key: K) => indexedHelper(key);
export const keyofType = <T>(value: T) => keyofHelper(value);
export const templateLiteral = <T extends string>(value: T) => templateHelper(value);
export const genericConstraint = constraintHelper(constraintSeed);
export const genericDefault = defaultHelper(defaultSeed);
export const typeofValue = (value: typeof internalValue) => value;
export const arrowParameter = wrapHelper((mode?: ArrowMode) => mode);
export const flattenedAlias = "first" as FlatMode | undefined;
export const importType = "near" as import("./internal").ImportMode | undefined;
export const augmentedVendor = () => augmentHelper();
// The seam case is annotated: its member is the one the census is told to treat as opaque.
export type { SeamAdapter, SeamHost } from "./internal";
