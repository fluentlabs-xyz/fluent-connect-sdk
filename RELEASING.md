# Releasing `@fluent.xyz/connect`

`main` is the only active long-lived branch ([ADR 0007](docs/adr/0007-main-is-the-sdk-trunk.md)).
Merging into `main` runs CI and publishes nothing. A version reaches npm only when a maintainer
dispatches `.github/workflows/release.yml` on `main` for the version the manifest already carries.
The run freezes the dispatched commit, called A below: every job checks out A, also on a re-run.
Later merges into `main`, including a later version PR, cannot change what an in-progress run
publishes.

A run passes through these jobs:

| Job | What it does | Writes |
| --- | --- | --- |
| `verify` | Checks the inputs, the registry and the version tags; frozen install, package-scoped build, typecheck and test on Node 24, `lint:pack`; packs the archive and its receipt | Run artifacts |
| `publish_rc` | Candidates only: publishes `X.Y.Z-rc.N` under `next`, then its tag and prerelease | npm, tag, Release |
| `verify_stable` | Candidates only: builds and verifies `X.Y.Z` from A, with only the manifest version changed | Run artifacts |
| `publish_stable` | Publishes `X.Y.Z` under `latest`, then its tag and Release | npm, tag, Release |
| `report` | Reports the final `state`: `published`, `verification_only`, `awaiting_stable_approval`, `blocked`, `abandoned` or `reconcile_required` | None |

The two publishing jobs run under the `npm-publish` environment. Each waits for its own deployment
approval, and the environment admits `main` only. Approving a candidate never approves its
promotion. The approver must be someone other than the person who dispatched the run. All
publications use trusted publishing (OIDC) with provenance.

A receipt (`receipt.json` in the run's artifacts) records the run ID, the source SHA, the version,
the dist-tag and the archive's SHA-512 integrity. A publishing job publishes that archive and
nothing else, after checking its digest against the receipt and the registry again.

## Version PR

A version PR is an ordinary pull request into `main` that changes only `"version"` in
`packages/connect/package.json`. It publishes nothing when merged.

- **Inputs**: the next version. A direct stable release uses `X.Y.Z`, greater than the npm
  `latest`. A candidate uses `X.Y.Z-rc.N`, whose `X.Y.Z` is greater than `latest` and unpublished;
  every new candidate takes a new `N`. No other form is released.
- **Commands**:

  ```bash
  git switch -c chore/connect-version-0-6-0-rc-1 origin/main
  # edit packages/connect/package.json: "version": "0.6.0-rc.1"
  gh pr create --base main --title "chore(connect): bump the version to 0.6.0-rc.1"
  ```

- **Approval owner**: the usual code owner of the pull request; `check (22)` and `check (24)`
  must be green.
- **Evidence to record**: the pull request URL and the merge commit, which becomes A.

## Dry run

A dry run verifies, packs and reports the release without requesting an approval or writing to
npm, Git tags or Releases. `dry_run` defaults to `true`, so a dispatch that omits it is a dry run.

- **Inputs**: `expected_version`, the version in the manifest at the head of `main`.
- **Commands**:

  ```bash
  gh workflow run release.yml --ref main -f expected_version=<version> -f dry_run=true
  gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
  ```

- **Approval owner**: none; a dry run requests no approval.
- **Evidence to record**: the run URL and the `report` job's outputs: `sha`, `version`, `channel`
  (`stable` or `rc`), `publishable` and `reason`. A dry run of a version already on npm still
  verifies and reports `publishable=false` with `reason=version_already_published`. A dry run of
  a candidate verifies both the candidate and the stable build. An invalid input or unreadable
  registry metadata ends the run `blocked`.

## Direct stable

- **Inputs**: `expected_version=X.Y.Z`, equal to the manifest at the head of `main`.
- **Commands**: run the dry run first, then:

  ```bash
  gh workflow run release.yml --ref main -f expected_version=<version> -f dry_run=false
  ```

  `publish_rc` is skipped. `publish_stable` waits for approval in the run's page ("Review
  deployments"); once approved, it publishes `X.Y.Z` under `latest` and creates the tag `vX.Y.Z`
  and its Release, both on A.
- **Approval owner**: an independent `npm-publish` approver, not the person who dispatched.
- **Evidence to record**: the run URL, A, the version, the approver, and the `report` state
  `published`.

## RC promotion

A candidate is published under `next`, validated by testers, and then promoted to the stable
version, built from the same commit A. The concrete flow for 0.6.0 is
`0.6.0-rc.1 → next → validation → second approval → 0.6.0 → latest`:

1. Merge the version PR that sets `0.6.0-rc.1`, then dry-run it.
2. Dispatch `gh workflow run release.yml --ref main -f expected_version=0.6.0-rc.1 -f dry_run=false`.
3. First approval, on `publish_rc`: `0.6.0-rc.1` is published under `next`, with the tag
   `v0.6.0-rc.1` and a prerelease Release on A. `latest` does not move.
4. `verify_stable` builds and verifies `0.6.0` from A, with only `packages/connect/package.json`'s
   version changed, and the run reports `awaiting_stable_approval`.
5. Testers install the exact candidate, never the moving `next` tag:

   ```bash
   pnpm add @fluent.xyz/connect@0.6.0-rc.1
   ```

6. Second approval, on `publish_stable`: `0.6.0` is published under `latest`, with the tag
   `v0.6.0` and its Release, on A.
7. Merge a version PR that sets `packages/connect/package.json` to `0.6.0`. The run never commits
   the promoted version, so until then `main` still carries `0.6.0-rc.1`. The PR publishes
   nothing, and a dry run of it reports `version_already_published`.

The run waits on the second approval while validation happens, holding the `release`
concurrency group; no other release starts meanwhile. A later version PR merged into `main` does
not change the candidate: the run publishes the stable build of A.

- **Approval owner**: an independent `npm-publish` approver for each of the two approvals.
- **Evidence to record**: the candidate version and A, the test results against
  `@fluent.xyz/connect@0.6.0-rc.1`, the approver of each approval, and the run URL.

## Cancellation

Reject the pending approval, or cancel the run, to abandon a candidate before its stable version
is published:

```bash
gh run cancel <run-id>
```

The run then ends `abandoned`, and the candidate cannot be promoted any more: a re-run of that
run refuses to publish the stable version. A replacement needs a new version PR with the next
`X.Y.Z-rc.N` and a new dispatch. Cancel a failed candidate's pending promotion before you dispatch
the next one; the `release` group runs one release at a time.

Cancellation cannot undo a completed npm publication. A publication in flight when the run is
cancelled may still have completed; check `npm view @fluent.xyz/connect versions --json` before
you assume it did not.

- **Approval owner**: the maintainer who abandons the candidate.
- **Evidence to record**: the run URL, the rejection or cancellation, and the reason.

## Retry and repair

A re-run is not a new dispatch. `gh run rerun <run-id> --failed` re-runs the failed jobs of the
same run, with the same commit A, the same ref and the same artifacts, and asks for approval
again ([GitHub: re-running workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)).
A new `gh workflow run` selects the head of `main` again, and it refuses a version this run
already published.

- **`reconcile_required`**: npm exited nonzero, which does not prove that the registry refused
  the write. Nothing else is written in that attempt. Re-run the failed jobs:

  ```bash
  gh run rerun <run-id> --failed
  ```

  If the retained archive still matches its receipt, and the registry holds the version with that
  integrity and provenance naming this run, commit A and `release.yml`, the job skips npm (`decision=metadata_only`) and completes
  only the tag and the Release. If the version is absent, the job publishes the retained archive
  once. Any other evidence ends the run `blocked`.
- **A failed tag or Release after a completed publication**: re-run the failed jobs the same
  way. An existing tag or Release on A counts as done.
- **`blocked`**: the run refused before writing anything more. Its log names the reason: an
  invalid input, unreadable or malformed registry metadata, a version already published by
  another run, a version not greater than `latest`, a tag on another commit, a missing or altered
  archive or receipt, or a retry proof that does not match. Fix the cause and dispatch a new run.
  A new run cannot reuse a published version: fix forward with the next version.
- **Manual tag and Release repair**: only after you have confirmed that the version's
  provenance names the original run and commit A:

  ```bash
  npm view @fluent.xyz/connect@<version> dist.integrity dist.attestations.url
  gh api -X POST repos/fluentlabs-xyz/fluent-connect-sdk/git/refs -f ref=refs/tags/v<version> -f sha=<A>
  gh release create v<version> --target <A> --title v<version> --notes "<notes>"
  ```

  Add `--prerelease` for a candidate. A tag that already points at another commit is a conflict:
  do not move it, investigate how it got there, and fix forward with a new version.
- **Immutable versions**: a published npm version can never be replaced or reused. A defect in
  one is fixed by a new version PR and a new release.
- **Authorized dist-tag rollback**: when a published stable version must stop being installed by
  default, an `npm-publish` approver moves `latest` back, and records why:

  ```bash
  npm dist-tag add @fluent.xyz/connect@<previous-version> latest
  ```

- **No retained archive or retry proof**: when the run's artifacts have expired or the proof does
  not match, the run cannot skip or repeat the write. If the registry already has the version,
  complete the tag and Release by hand as above once its provenance names A. Otherwise fix
  forward with the next version from a new dispatch.
- **Approval owner**: an independent `npm-publish` approver for every re-run that reaches a
  publishing job.
- **Evidence to record**: both run attempt URLs, the registry's integrity and provenance for the
  version, and the repaired tag and Release.

## Migration

The one-time cutover from `devel` to `main` (FLU-1698). Each stage records its evidence in the
migration pull request.

1. Pause legacy publication. Before anything merges into `main`, resolve or cancel every pending
   or running run of the old push-triggered `release` workflow, approval waits included, and
   stop requiring the old `release-gate` check. Record the workflow and job URLs.

2. Prepare the migration pull request: a short-lived branch from the refreshed `devel` into
   `main`, carrying the new `release.yml`, the `ci.yml` changes and the removal of
   `release-gate.yml`. Record both input SHAs and the reconciliation diff against `main`,
   including any content only `main` has.

3. Require the status checks `check (22)` and `check (24)` on `main`, and make the required
   status checks on `main` apply to repository administrators too, with no bypass. Keep the
   existing review, signature, deletion and non-fast-forward rules. Record the applied rules
   from `gh api repos/fluentlabs-xyz/fluent-connect-sdk/rules/branches/main`. Record an
   unchanged-version pull request that goes green, and a pull request with a harmless failing
   check that is blocked.

4. Merge the migration pull request with a merge commit, never a squash or a rebase. Check that
   `git merge-base --is-ancestor <input> <result>` holds for both input SHAs, and that the
   resulting push to `main` ran CI and published nothing.

5. Retarget every open pull request from `devel` to `main`, keeping its branch name, and record
   each one's checks. Retire `devel`: restrict updates to it and keep its history. It is not
   deleted, and nothing is force-pushed.

6. Hand the SDK base mapping to the hub owner: the hub's `config.yaml` must set
   `repos.fluent-connect-sdk.base: main` before further SDK work starts.

7. Check the `npm-publish` environment: it admits `main` only, it has independent required
   reviewers, and it prevents self-approval. Check on npmjs.com that the package's trusted
   publisher is `fluentlabs-xyz/fluent-connect-sdk`, workflow `release.yml`, environment
   `npm-publish`. Then run the [dry run](#dry-run) of the current version and record its run URL
   and the reported SHA, version and publishability.

- **Approval owner**: the repository administrator who performs the cutover.
- **Evidence to record**: the evidence named in each stage, in the migration pull request.
