/**
 * The production `ReleaseIO`: the npm CLI for packing and publishing, `fetch` for registry
 * reads, and the GitHub REST API through `gh api` for tags, Releases and the run's history.
 * `gh` reads its token from `GH_TOKEN`, which each release job sets to `github.token`.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ReleaseIO, ReleaseRecord, RunHistory } from "./release.ts";

interface Completed {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], cwd?: string): Promise<Completed> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function notFound(result: Completed): boolean {
  return result.code !== 0 && /HTTP 404|Not Found/.test(result.stderr);
}

export function createRealIO(env: Record<string, string | undefined>): ReleaseIO {
  const repo = env.GITHUB_REPOSITORY ?? "";

  async function gh(args: string[], allowMissing = false): Promise<unknown> {
    const result = await run("gh", ["api", ...args]);
    if (allowMissing && notFound(result)) return null;
    if (result.code !== 0) throw new Error(`gh api ${args[0]}: ${result.stderr.trim()}`);
    return result.stdout.trim() === "" ? null : (JSON.parse(result.stdout) as unknown);
  }

  async function tagTarget(tag: string): Promise<string | null> {
    const ref = (await gh([`repos/${repo}/git/ref/tags/${tag}`], true)) as
      | { object: { type: string; sha: string } }
      | null;
    if (!ref) return null;
    if (ref.object.type !== "tag") return ref.object.sha;
    const annotated = (await gh([`repos/${repo}/git/tags/${ref.object.sha}`])) as {
      object: { sha: string };
    };
    return annotated.object.sha;
  }

  return {
    fetch: (input, init) => fetch(input, init),

    async pack(packageDir, destination) {
      // The package was built and verified in this job; `prepack` would rebuild it unchecked.
      const result = await run("npm", ["pack", "--ignore-scripts", "--json",
        "--pack-destination", destination], packageDir);
      if (result.code !== 0) throw new Error(`npm pack failed: ${result.stderr.trim()}`);
      const [entry] = JSON.parse(result.stdout) as Array<{ filename: string }>;
      if (!entry) throw new Error("npm pack produced no archive");
      return join(destination, entry.filename);
    },

    async npmPublish(archive, distTag) {
      const result = await run("npm", ["publish", archive, "--provenance", "--access", "public",
        "--tag", distTag]);
      return { exitCode: result.code, output: `${result.stdout}${result.stderr}`.trim() };
    },

    tagTarget,

    async createTag(tag, sha) {
      await gh(["-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/tags/${tag}`,
        "-f", `sha=${sha}`]);
    },

    async getRelease(tag): Promise<ReleaseRecord | null> {
      const release = (await gh([`repos/${repo}/releases/tags/${tag}`], true)) as {
        tag_name: string;
        target_commitish: string;
        prerelease: boolean;
        name: string | null;
        body: string | null;
      } | null;
      if (!release) return null;
      // A Release made for an existing tag reports the tag's commit only through the tag.
      const target = /^[0-9a-f]{40}$/.test(release.target_commitish)
        ? release.target_commitish
        : ((await tagTarget(tag)) ?? release.target_commitish);
      return {
        tag: release.tag_name,
        target,
        prerelease: release.prerelease,
        title: release.name ?? "",
        notes: release.body ?? "",
      };
    },

    async createRelease(release) {
      await gh(["-X", "POST", `repos/${repo}/releases`, "-f", `tag_name=${release.tag}`,
        "-f", `target_commitish=${release.target}`, "-f", `name=${release.title}`,
        "-f", `body=${release.notes}`, "-F", `prerelease=${release.prerelease}`]);
    },

    async runHistory(runId): Promise<RunHistory> {
      const approvals = ((await gh([`repos/${repo}/actions/runs/${runId}/approvals`])) ??
        []) as Array<{ state: "approved" | "rejected"; environments: Array<{ name: string }> }>;
      const current = Number(env.GITHUB_RUN_ATTEMPT ?? "1");
      const attempts: RunHistory["attempts"] = [];
      for (let attempt = 1; attempt <= current; attempt += 1) {
        const detail = (await gh([`repos/${repo}/actions/runs/${runId}/attempts/${attempt}`])) as {
          conclusion: string | null;
        };
        attempts.push({ attempt, conclusion: detail.conclusion });
      }
      return {
        approvals: approvals.flatMap((approval) =>
          approval.environments.map((environment) => ({
            state: approval.state,
            environment: environment.name,
            job: "",
          }))),
        attempts,
      };
    },
  };
}
