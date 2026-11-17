# Changelog

[Chinese](CHANGELOG.zh.md). Entries cover released and upcoming changes; see
[GitHub Releases](https://github.com/JilongSun/mabrid/releases) for published versions.

## 0.2.1

### Fixed

- Aggregate Gateway MCP initialization reports the installed Mabrid version instead of a fixed
  `0.1.0`.
- Streamable HTTP and SSE use the same effective identity. Passthrough endpoints preserve the
  upstream server's name, version, and instructions.
- README version badges follow the latest published Release. A separate badge reports `main` CI
  status, and developer-preview notices no longer hard-code a product version.
- Release publication reads the matching version from the root bilingual changelogs, falling back
  to GitHub-generated notes when absent. Reruns leave existing public Releases unchanged.

There are no configuration-format changes from 0.2.0, new Agent capabilities, or changes to the
trusted-deployment boundary.

## 0.2.0

### Highlights

- Manage supported MCP upstreams, endpoints, and bindings through Gateway Settings. Configure
  Hermes, native Sessions, and its write-only API key through Host Settings.
- Save configuration separately from applying it. Gateway application affects new bridge Sessions;
  Host application requires no in-flight Host operations or active or unsettled Runs.
- Prepare versions through a version pull request and publish GitHub Releases from matching tags
  after CI succeeds.

### Configuration

- Static process settings stay in `mabrid.yaml`. Topology and Agent Host settings belong in the
  runtime file. New setup uses `runtime/mabrid.runtime.yaml`, selected through `runtimeConfigFile`;
  without an explicit path, the adjacent runtime file remains the default.
- The runtime file is authoritative. SQLite retains applied Gateway revisions and Session history,
  not a second editable configuration source. Existing bridge Sessions retain captured revisions.
- Set the Host key through Host Settings or `agentHost.runtime.apiKey`. The former `apiKeyEnv`
  field is rejected; `.env` cannot supply or override the Host key.
- Static process settings require restart. Stdio commands, arguments, working directories, and
  environment remain file-managed.

This remains a developer preview without stable configuration-format or database-upgrade guarantees.
Back up configuration and data before changing versions; do not automatically delete existing storage.

### Deployment Boundaries

Management remains unauthenticated and is intended only for trusted deployments. Runtime files and
backups contain plaintext credentials and require access protection. This release does not harden
MCP App network isolation or add automatic retries of tool calls or Agent Runs.

GitHub provides tagged source archives. Automatic OCI image publication is not included.