# CI and Release Automation

GitHub Actions workflows live in `.github/workflows/`, not `.vscode/`. Local checks and Actions
reuse [scripts/check.py](../../scripts/check.py); version and release operations use
[scripts/release.py](../../scripts/release.py). These are development tools, not deployment-host
requirements. Native container management still uses shell or PowerShell without Python or uv.

## Local Checks

Install the workspace dependencies with uv and the frontend dependencies with pnpm first. CI uses
Python 3.12, Node 24, uv 0.11.25, and pnpm 11.9.0. Dependency installation uses the committed locks.

| Make | Just | Scope |
| --- | --- | --- |
| `make check` | `just check` | All Linux/development gates |
| `make check SCOPE=backend` | `just check backend` | Backend tests, types, lint, formatting, contracts, versions |
| `make check SCOPE=frontend` | `just check frontend` | Frontend tests, types, lint, production build |
| `make contracts` | `just contracts` | Three generated contract snapshots |
| `make version-check` | `just version-check` | Product metadata, installed packages, lockfile, API snapshot |

These commands never invoke real Docker, Agents, MCP servers, or operator configuration. Native
deployment tests use Docker doubles. Linux runs the full backend suite, including Unix script
tests; a separate Windows job requires Windows PowerShell and runs the Windows script cases.
Real container deployment, directory ACLs, credentials, and remote integrations require separate
acceptance. The deliberate Windows ACL skip is not proof of deployment acceptance.

`make build` and `just build` retain their existing container-image meaning; they are not CI checks.

## Generated Contracts

The three artifacts are generated views of actual Python authorities, not parallel hand-maintained
schemas:

- [Frontend contract](../contracts/v0.1/frontend-contract.json): FastAPI OpenAPI, Pydantic SSE
  schemas, and explicit stream/error metadata.
- [Process configuration schema](../contracts/configuration/mabrid.schema.json):
  `ProcessFileConfig`, using canonical camelCase validation fields.
- [Runtime configuration schema](../contracts/configuration/mabrid.runtime.schema.json):
  `RuntimeFileConfig`, including Gateway topology and credential-bearing Host file settings.

Regenerate after an intentional contract change, then review the diff:

```sh
uv run --directory backend --all-packages --locked python -m mabrid.server.api.frontend_contract ../docs/contracts/v0.1/frontend-contract.json
uv run --directory backend --all-packages --locked python -m mabrid.server.config.schema ../docs/contracts/configuration
make contracts
```

Generation is offline and does not load real YAML, secrets, databases, or runtime services. CI checks
snapshot drift, public YAML templates, controlled enabled-Host/transport examples, and configuration
semantics. JSON Schema cannot express every custom model validator, cross-file rule, runtime idle
condition, or credential validity check; the actual models, loaders, and application tests remain
authoritative for those behaviors.

[Workspace settings](../../.vscode/settings.json) associate the YAML files and templates with their
schemas for the recommended YAML extension. No `$schema` product field is added to configuration.
The preview frontend contract directory is independent of the product's patch/minor version.

## Product Versions

One product version is carried by the four Python project metadata files and the frontend package.
Backend runtime reports read installed distribution metadata; Vite injects frontend package metadata
into MCP Apps Host information. Runtime version resolution does not require Git.

Metadata accepts only plain `X.Y.Z`, with three ASCII numeric segments and no leading zeroes except
zero itself. A release tag is exactly `vX.Y.Z`. Prereleases, development/post releases, and build
suffixes are outside this workflow.

During `0.x`, compatible fixes increment patch; new features or incompatible API/configuration
changes increment minor and reset patch. The product may remain a developer preview in `0.x`
without stable API guarantees. `1.0.0` requires a separate compatibility decision. Automation never
infers a target version from commits, and ordinary feature merges do not bump or publish versions.

For local preparation on clean tracked source:

```sh
make prepare-version VERSION=X.Y.Z
# Equivalent: just prepare-version X.Y.Z
```

The target must be greater than the current version and must not already have a local release tag.
The tool uses `uv version --frozen` for each Python project, updates the frontend JSON structurally,
refreshes the existing uv lock while retaining pinned dependencies, syncs package metadata, and
regenerates the version-bearing API snapshot. Lock refresh may fetch registry metadata; it does not
require a prewarmed cache. The pnpm lock does not contain the root package's
version and does not need a version-only rewrite. Preparation never commits, pushes, or tags.
If preparation fails, inspect the diff and fix the cause before committing; do not publish partially
prepared source. The tool does not reset or discard working-tree changes.

Patch releases use the same workflow. For example, after maintenance changes for `0.2.1` have
merged into `main` at source version `0.2.0`, dispatch **Prepare Version** with `0.2.1` (without
`v`). Review and merge that version PR, then create and push `v0.2.1` on the prepared commit.
Do not bump metadata by hand in the maintenance PR or reuse the already published `v0.2.0` tag.

README version badges query the latest published GitHub Release and link to `releases/latest`;
they do not report the version of a checkout or development build. Until `v0.2.1` is published,
the badge correctly remains at `v0.2.0`. A separate CI badge selects `main` push runs. Neither
badge requires a release-time source rewrite, and badge caches may delay visual updates.

## Workflows and Permissions

[CI](../../.github/workflows/ci.yml) runs for PRs targeting `main` and pushes to `main`, and is also
reusable by the release workflow. It has read-only contents permission, no secrets inheritance,
no path filtering, and no privileged `pull_request_target` or `workflow_run` execution. Superseded
PR checks are cancelled. The stable **Required Checks** job runs with `always()` and accepts only
success from Backend, Frontend, and Windows Native Scripts; missing, skipped, failed, or cancelled
dependencies cannot produce a green aggregate.

[Prepare Version](../../.github/workflows/prepare-version.yml) is manually dispatched on `main`
with a maintainer-selected version. It opens or updates the automation-owned `release/vX.Y.Z` PR
using `GITHUB_TOKEN`, with only version-owned files eligible for its commit. Do not mix feature work
into that branch. Only this trusted job has contents/PR write permission. It does not merge or tag.
Repeated preparation updates the same version PR rather than creating duplicate PRs.

[Release](../../.github/workflows/release.yml) starts from a pushed `v*` tag. Strict validation
rejects unsupported names, metadata/lock/contract mismatches, a checkout different from the tagged
commit, or a commit outside `main` history. It runs the same CI on the exact tagged source before
the publication job receives contents-write permission. Releases for different tags do not cancel
each other.

Publication creates a public, non-prerelease GitHub Release. Maintain concise user-facing history
in the root [English changelog](../../CHANGELOG.md) and [Chinese changelog](../../CHANGELOG.zh.md),
not separate files per version. Commit entries with the relevant changes, before the version PR,
using exact `## X.Y.Z` headings and level-three headings for subsections. Use Highlights for minor
feature releases and Fixed for patch releases.

Patch releases may be batched. Record fixes under the next-release heading (`## Unreleased` in the
English changelog, `## 未发布` in the Chinese changelog) as they merge, instead of preparing a
version, tag, and Release for every fix. When the maintainer decides a batch is worth publishing,
rename that heading to the target version in both files and run the normal release flow. Those
headings are never published because only exact version headings are matched. Between releases the
reported product version remains the last published version even though `main` already contains
the batched fixes; identify such builds by commit or image digest. An urgent fix may still be
released immediately as its own patch version.

Publication extracts only the matching version from each available language and combines them into
the release body. A matching empty or duplicate entry is an error. A version without an entry uses
GitHub-generated notes from merged PRs; there is no requirement to author a changelog entry for
every tag. Use user-facing PR titles for that fallback.
There are no internal contract attachments, Python/npm publication, or automatic OCI builds.
GitHub's automatic source archives describe the prepared tagged source.
A rerun confirms an existing public release only when its tag and target commit agree; it never
edits notes, replaces assets, promotes a draft, or moves a tag. API errors fail rather than being
treated as proof that no release exists.

Action dependencies are pinned to reviewed commits: checkout 7.0.1, setup-node 7.1.0, setup-uv
10.3.3, and create-pull-request 8.1.3. Review both the code and fixed references when updating them.

## First GitHub Acceptance

The first version-preparation, PR/main CI, hosted Windows checks, and tag-publication chain
succeeded for `v0.2.0` on 2026-11-17. See the [decision log](../architecture/decision-log.md#v020-publication-and-release-maintenance-2026-11-17)
for the observed runs and limits. Branch-protection settings, publication reruns, and real
container acceptance are not established by those successful runs.

Local validation is not GitHub acceptance. Perform these steps only when integration is authorized:

1. Push the feature branch and open a PR into `main`. Verify all three CI jobs and Required Checks
   run on the PR. No repository protection is established merely by adding workflow YAML.
2. After the check has appeared, configure the `main` rule to require PRs and **Required Checks**
   from GitHub Actions. Prevent force-push and deletion. Enable merge commits, do not require
   linear history, and retain the long-lived feature branch after integration. Check actual admin
   bypass behavior; do not assume administrators are covered by default. No extra-maintainer
   approval, auto-merge, or merge queue is required for this initial policy.
3. The maintainer selects **Create a merge commit** after green checks. Verify `main` CI runs and
   succeeds. Record this as merge-CI evidence, not release-chain acceptance.
4. For version preparation, allow GitHub Actions to create pull requests in Actions settings.
   `workflow_dispatch` becomes available after the workflow reaches the default branch. Dispatch
   **Prepare Version** on `main` with the selected version, review its bounded diff, and approve
   the bot PR's workflow run when GitHub requests **Approve workflows to run**. Merge only after
   Required Checks passes.
5. Select the prepared commit in `main` history, verify main CI, and create/push its matching tag
   using maintainer credentials. A tag pushed with `GITHUB_TOKEN` does not trigger a push workflow.
   Do not tag first and repair source afterward. Verify source checks and public Release creation,
   then rerun the successful release once to confirm it leaves the existing release unchanged.

Do not move published tags or rewrite public releases to hide failed preparation. Actual branch
rules, bot-run approval, hosted Windows behavior, and publication reruns need this GitHub evidence;
controlled local tests do not establish them.