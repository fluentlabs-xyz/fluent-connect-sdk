# Use `main` as the SDK trunk and select releases explicitly

The SDK previously integrated work on `devel` and published every merge into `main`, coupling the branch switch to npm publication. Use `main` as the only active long-lived branch, kept releasable by required CI, and publish explicitly selected immutable revisions independently of subsequent merges. This replaces freezing development or maintaining release branches during validation with validating and approving a fixed commit, so main can advance without changing the release candidate.

## Consequences

A merge into `main` runs CI and nothing else, whatever version the manifest carries. A version reaches npm only through a dispatch of `.github/workflows/release.yml` on `main` for the version the manifest already holds, and every job of that run checks out the dispatch's commit, so later merges cannot change what it publishes (FLU-1698). A version PR changes `packages/connect/package.json` and is reviewed like any other change. A candidate, `X.Y.Z-rc.N`, is published under `next`, and its stable version is built from the same commit with only the manifest version changed, under its own approval. `devel` is kept as a read-only reference, not deleted. `RELEASING.md` is the procedure.
