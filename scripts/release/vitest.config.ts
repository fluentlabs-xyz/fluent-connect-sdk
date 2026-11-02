import { defineConfig } from "vitest/config";

/**
 * The release suite runs apart from the four projects in `vitest.workspace.ts`: it tests the
 * repository's workflows and release helpers rather than a package, so `turbo run test` does not
 * reach it and `pnpm run test:release` runs it on its own.
 */
export default defineConfig({
  test: {
    include: ["scripts/release/**/*.test.ts"],
  },
});
