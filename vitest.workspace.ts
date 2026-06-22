import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/registry",
  "packages/chains",
  "packages/sdk",
  "packages/react",
]);
