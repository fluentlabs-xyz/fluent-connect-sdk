/**
 * A same-run retry must retain the verified archive before completing publication metadata.
 * Fakes: npm registry/CLI, GitHub tags/Releases, approvals and run history from test/fakes.ts,
 * using the external contracts documented there. Production release phases run unchanged.
 */
import { describe, expect, it } from "vitest";
import { createWorld } from "./test/fixtures.ts";
import { dispatch, rerunFailed } from "./test/workflow.ts";

describe("Retry archive validation", () => {
  it.each(["missing", "corrupt"])(
    "blocks metadata writes when the retained archive is %s after an ambiguous publish",
    async (damage) => {
      const world = createWorld({ version: "0.6.0", approvals: ["approve", "approve"] });
      world.npmFailures.push({ version: "0.6.0", mode: "after_write" });
      const first = await dispatch(world, {
        inputs: { expected_version: "0.6.0", dry_run: false },
      });
      expect(first.state).toBe("reconcile_required");
      expect(world.registry.versions.has("0.6.0")).toBe(true);

      let changed = 0;
      for (const files of first.artifacts.values()) {
        for (const path of files.keys()) {
          if (!path.endsWith(".tgz")) continue;
          if (damage === "missing") files.delete(path);
          else files.set(path, Buffer.from("corrupted retained archive"));
          changed += 1;
        }
      }
      expect(changed).toBe(1);

      const retry = await rerunFailed(world, first);
      expect.soft(retry.state).toBe("blocked");
      expect.soft(retry.decision).toBe("blocked");
      expect.soft(retry.trace).toEqual([]);
    },
  );
});
