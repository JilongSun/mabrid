"""Controlled tests for development and release automation; no remote publication."""

import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


def load_script(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / f"scripts/{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


@pytest.fixture
def delivery() -> ModuleType:
    return load_script("release")


def write_project(path: Path, name: str, value: str = "0.1.0") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'[project]\nname = "{name}"\nversion = "{value}"\n', encoding="utf-8")


def write_lock(root: Path, names: list[str], value: str = "0.1.0") -> None:
    (root / "backend/uv.lock").write_text(
        "\n".join(f'[[package]]\nname = "{name}"\nversion = "{value}"\n' for name in names),
        encoding="utf-8",
    )


@pytest.fixture
def repository(tmp_path: Path, delivery: ModuleType) -> Path:
    names = ["mabrid-workspace", "mabrid-server", "mabrid-application", "mabrid-bridge"]
    for filename, name in zip(delivery.PROJECTS, names, strict=True):
        write_project(tmp_path / filename, name)
    workspace = tmp_path / delivery.PROJECTS[0]
    with workspace.open("a", encoding="utf-8") as output:
        output.write(
            "\n[tool.uv]\npackage = false\n[tool.uv.workspace]\n"
            'members = ["apps/server", "packages/application", "packages/bridge"]\n'
        )
    frontend = tmp_path / delivery.FRONTEND
    frontend.parent.mkdir(parents=True)
    frontend.write_text(json.dumps({"name": "fixture", "version": "0.1.0", "private": True}))
    contract = tmp_path / delivery.CONTRACT
    contract.parent.mkdir(parents=True)
    contract.write_text(json.dumps({"openapi": {"info": {"version": "0.1.0"}}}))
    write_lock(tmp_path, names)
    return tmp_path


@pytest.mark.parametrize("value", ["0.1.0", "0.2.1", "0.12.34", "1.0.0", "10.20.30"])
def test_plain_product_versions(delivery: ModuleType, value: str) -> None:
    assert delivery.version_parts(value) == tuple(map(int, value.split(".")))


@pytest.mark.parametrize(
    "value",
    [
        "v0.1.0",
        "01.0.0",
        "0.01.0",
        "1.0",
        "1.0.0rc1",
        "1.0.0-rc.1",
        "1.0.0+build",
        "１.0.0",
        "1.0.0\n",
    ],
)
def test_reject_unsupported_versions(delivery: ModuleType, value: str) -> None:
    with pytest.raises(ValueError, match="plain X.Y.Z"):
        delivery.version_parts(value)


def test_repository_versions_include_metadata_lock_and_contract(
    delivery: ModuleType, repository: Path
) -> None:
    assert delivery.check_versions(repository, installed=False) == "0.1.0"
    assert delivery.check_versions(ROOT) == delivery.projects(ROOT)[delivery.PROJECTS[0]]["version"]


@pytest.mark.parametrize("surface", ["metadata", "lock", "contract", "installed"])
def test_version_drift_is_rejected(
    delivery: ModuleType, repository: Path, monkeypatch: pytest.MonkeyPatch, surface: str
) -> None:
    if surface == "metadata":
        write_project(repository / delivery.PROJECTS[1], "mabrid-server", "0.2.0")
    elif surface == "lock":
        write_lock(repository, ["mabrid-workspace"], "0.2.0")
    elif surface == "contract":
        (repository / delivery.CONTRACT).write_text(
            json.dumps({"openapi": {"info": {"version": "0.2.0"}}})
        )
    else:
        monkeypatch.setattr(delivery, "version", lambda _: "0.2.0")
    with pytest.raises(ValueError, match="differ"):
        delivery.check_versions(repository, installed=surface == "installed")


@pytest.mark.parametrize("target", ["0.1.0", "0.0.9", "0.2.0rc1"])
def test_invalid_preparation_never_mutates_source(
    delivery: ModuleType, repository: Path, monkeypatch: pytest.MonkeyPatch, target: str
) -> None:
    def reject_command(*args, **kwargs):
        raise AssertionError("Invalid targets must fail before invoking tools")

    monkeypatch.setattr(delivery, "run", reject_command)
    before = (repository / delivery.FRONTEND).read_bytes()
    with pytest.raises(ValueError):
        delivery.prepare_version(repository, target)
    assert (repository / delivery.FRONTEND).read_bytes() == before


@pytest.mark.parametrize("blocker", ["dirty", "existing-tag", "git-error"])
def test_preparation_refuses_dirty_source_or_existing_tags(
    delivery: ModuleType, repository: Path, monkeypatch: pytest.MonkeyPatch, blocker: str
) -> None:
    def command(arguments, root, *, check=True):
        assert arguments[0] == "git"
        if arguments[1] == "status":
            return subprocess.CompletedProcess(
                arguments, 0, " M frontend/package.json" if blocker == "dirty" else ""
            )
        return subprocess.CompletedProcess(arguments, 0 if blocker == "existing-tag" else 128, "")

    monkeypatch.setattr(delivery, "run", command)
    with pytest.raises(ValueError):
        delivery.prepare_version(repository, "0.2.0")
    assert delivery.check_versions(repository, installed=False) == "0.1.0"


def test_preparation_uses_real_uv_and_updates_only_expected_sources(
    delivery: ModuleType, repository: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []
    original = delivery.run

    def command(arguments, root, *, check=True):
        commands.append(arguments)
        if arguments[:2] == ["uv", "version"]:
            assert "--frozen" in arguments and "--no-sync" not in arguments
            return original(arguments, root, check=check)
        if arguments[:2] == ["git", "show-ref"]:
            return subprocess.CompletedProcess(arguments, 1, "")
        if arguments[:2] == ["uv", "lock"]:
            assert arguments == ["uv", "lock", "--directory", "backend"]
            write_lock(
                repository,
                [project["name"] for project in delivery.projects(repository).values()],
                "0.2.0",
            )
        if "mabrid.server.api.frontend_contract" in arguments:
            (repository / delivery.CONTRACT).write_text(
                json.dumps({"openapi": {"info": {"version": "0.2.0"}}})
            )
        return subprocess.CompletedProcess(arguments, 0, "")

    monkeypatch.setattr(delivery, "run", command)
    delivery.prepare_version(repository, "0.2.0")
    assert delivery.check_versions(repository, installed=False) == "0.2.0"
    assert len([command for command in commands if command[:2] == ["uv", "version"]]) == 4
    assert json.loads((repository / delivery.FRONTEND).read_text())["private"] is True
    assert all(not ({"commit", "push", "tag"} & set(command)) for command in commands)


def test_preparation_refreshes_installed_versions_and_contract_in_isolation(
    delivery: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for filename in (*delivery.PROJECTS, "backend/uv.lock", delivery.FRONTEND, delivery.CONTRACT):
        destination = tmp_path / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / filename, destination)
    for package in ("apps/server", "packages/application", "packages/bridge"):
        shutil.copytree(
            ROOT / f"backend/{package}/src",
            tmp_path / f"backend/{package}/src",
            ignore=shutil.ignore_patterns("__pycache__", "debug_main.py"),
        )
    shutil.copytree(
        ROOT / "backend/apps/server/migrations", tmp_path / "backend/apps/server/migrations"
    )
    (tmp_path / "scripts").mkdir()
    shutil.copyfile(ROOT / "scripts/release.py", tmp_path / "scripts/release.py")
    lockfile = tmp_path / "backend/uv.lock"
    dependencies = {
        package["name"]: package["version"]
        for package in tomllib.loads(lockfile.read_text(encoding="utf-8"))["package"]
        if "registry" in package["source"]
    }
    monkeypatch.setenv("UV_CACHE_DIR", str(tmp_path / "uv-cache"))
    monkeypatch.setenv("UV_PROJECT_ENVIRONMENT", str(tmp_path / "backend/.venv"))
    monkeypatch.setenv("UV_PYTHON", sys.executable)
    monkeypatch.delenv("VIRTUAL_ENV", raising=False)
    original = delivery.run

    def command(arguments, root, *, check=True):
        if arguments[0] == "git":
            return subprocess.CompletedProcess(arguments, int(arguments[1] == "show-ref"), "")
        try:
            return original(arguments, root, check=check)
        except subprocess.CalledProcessError as error:
            pytest.fail(f"Isolated version preparation failed: {error.stderr}")

    monkeypatch.setattr(delivery, "run", command)
    current = delivery.version_parts(delivery.check_versions(ROOT, installed=False))
    target = f"{current[0]}.{current[1]}.{current[2] + 1}"
    delivery.prepare_version(tmp_path, target)
    assert delivery.check_versions(tmp_path, installed=False) == target
    assert {
        package["name"]: package["version"]
        for package in tomllib.loads(lockfile.read_text(encoding="utf-8"))["package"]
        if "registry" in package["source"]
    } == dependencies
    installed = original(
        [
            "uv",
            "run",
            "--directory",
            "backend",
            "--all-packages",
            "--locked",
            "python",
            "../scripts/release.py",
            "check",
        ],
        tmp_path,
    )
    assert installed.stdout.strip() == target


@pytest.mark.parametrize(
    "blocker", ["none", "format", "version", "checkout", "ancestry", "git-error"]
)
def test_tag_verification_requires_exact_prepared_source_in_main(
    delivery: ModuleType, repository: Path, monkeypatch: pytest.MonkeyPatch, blocker: str
) -> None:
    monkeypatch.setattr(delivery, "version", lambda _: "0.1.0")
    calls: list[list[str]] = []

    def command(arguments, root, *, check=True):
        calls.append(arguments)
        if "merge-base" in arguments:
            return subprocess.CompletedProcess(
                arguments, {"ancestry": 1, "git-error": 128}.get(blocker, 0), ""
            )
        value = "b" * 40 if blocker == "checkout" and arguments[-1] != "HEAD" else "a" * 40
        return subprocess.CompletedProcess(arguments, 0, value)

    monkeypatch.setattr(delivery, "run", command)
    tag = {"format": "0.1.0", "version": "v0.2.0"}.get(blocker, "v0.1.0")
    if blocker == "none":
        assert delivery.verify_tag(repository, tag) == "a" * 40
    else:
        with pytest.raises(ValueError):
            delivery.verify_tag(repository, tag)
    assert all(arguments[0] == "git" for arguments in calls)


@pytest.mark.parametrize(
    "existing", ["none", "matching", "draft", "prerelease", "wrong-commit", "api-error"]
)
@pytest.mark.parametrize("authored_notes", [False, True])
def test_publication_is_fail_closed_and_never_rewrites_releases(
    delivery: ModuleType,
    repository: Path,
    monkeypatch: pytest.MonkeyPatch,
    existing: str,
    authored_notes: bool,
) -> None:
    monkeypatch.setattr(delivery, "verify_tag", lambda *_: "a" * 40)
    calls: list[list[str]] = []
    notes = repository / "CHANGELOG.md"
    if authored_notes:
        notes.write_text("# Changelog\n\n## 0.1.0\n\nControlled release notes.\n", encoding="utf-8")

    def command(arguments, root, *, check=True):
        calls.append(arguments)
        if arguments[1] == "api":
            if existing == "api-error":
                raise subprocess.CalledProcessError(1, arguments, stderr="Controlled API failure")
            release = {
                "tag_name": "v0.1.0",
                "draft": existing == "draft",
                "prerelease": existing == "prerelease",
                "target_commitish": "b" * 40 if existing == "wrong-commit" else "a" * 40,
                "html_url": "https://example.invalid/release",
            }
            return subprocess.CompletedProcess(
                arguments, 0, json.dumps([[], [] if existing == "none" else [release]])
            )
        return subprocess.CompletedProcess(arguments, 0, "https://example.invalid/release")

    monkeypatch.setattr(delivery, "run", command)
    if existing in {"none", "matching"}:
        delivery.publish_release(repository, "v0.1.0")
    else:
        with pytest.raises((ValueError, subprocess.CalledProcessError)):
            delivery.publish_release(repository, "v0.1.0")
    writes = [arguments for arguments in calls if arguments[1] != "api"]
    assert len(writes) == (existing == "none")
    if writes:
        assert writes[0][:4] == ["gh", "release", "create", "v0.1.0"]
        assert "--verify-tag" in writes[0]
        if authored_notes:
            assert writes[0][-2:] == ["--notes", "# English\n\nControlled release notes."]
            assert "--generate-notes" not in writes[0]
        else:
            assert writes[0][-1] == "--generate-notes"
        assert "--target" in writes[0] and "--draft" not in writes[0]
    assert all("edit" not in arguments and "upload" not in arguments for arguments in calls)


@pytest.mark.parametrize("filename", ["CHANGELOG.md", "CHANGELOG.zh.md"])
@pytest.mark.parametrize("body", ["\n", "\nNotes.\n\n## 0.1.0\n\nDuplicate.\n"])
def test_publication_rejects_invalid_authored_notes_before_creating_release(
    delivery: ModuleType,
    repository: Path,
    monkeypatch: pytest.MonkeyPatch,
    filename: str,
    body: str,
) -> None:
    monkeypatch.setattr(delivery, "verify_tag", lambda *_: "a" * 40)
    notes = repository / filename
    notes.write_text(f"# Changelog\n\n## 0.1.0\n{body}", encoding="utf-8")

    def command(arguments, root, *, check=True):
        assert arguments[:2] == ["gh", "api"]
        return subprocess.CompletedProcess(arguments, 0, "[]")

    monkeypatch.setattr(delivery, "run", command)
    with pytest.raises(ValueError, match="Release notes must not be empty|Duplicate release entry"):
        delivery.publish_release(repository, "v0.1.0")


def test_changelog_notes_selects_only_matching_version_in_both_languages(
    delivery: ModuleType, repository: Path
) -> None:
    for filename in ("CHANGELOG.md", "CHANGELOG.zh.md"):
        (repository / filename).write_text(
            f"# Changelog\n\n## 0.2.0\n\nNewer entry.\n\n## 0.1.0\n\n"
            f"### Highlights\n\nNotes from {filename}.\n\n## 0.0.9\n\nOlder entry.\n",
            encoding="utf-8",
        )
    assert delivery.changelog_notes(repository, "v0.1.0") == (
        "# English\n\n### Highlights\n\nNotes from CHANGELOG.md.\n\n"
        "# Chinese\n\n### Highlights\n\nNotes from CHANGELOG.zh.md."
    )
    assert delivery.changelog_notes(repository, "v0.1.1") == ""


@pytest.fixture
def checks() -> ModuleType:
    return load_script("check")


@pytest.mark.parametrize(
    "outcome", ["success", "failure", "cancelled", "skipped", "missing", "extra"]
)
def test_aggregate_gate_accepts_only_all_required_successes(
    checks: ModuleType, outcome: str
) -> None:
    results = {job: {"result": "success"} for job in checks.REQUIRED_JOBS}
    if outcome == "missing":
        results.pop("backend")
    elif outcome == "extra":
        results["unexpected"] = {"result": "success"}
    else:
        results["backend"]["result"] = outcome
    if outcome == "success":
        checks.check_gate(results)
    else:
        with pytest.raises(ValueError):
            checks.check_gate(results)


def test_shared_checks_cover_release_gates_without_real_deployment(checks: ModuleType) -> None:
    backend = checks.commands("backend")
    assert {
        "pytest",
        "pyright",
        "ruff",
        "mabrid.server.config.schema",
        "mabrid.server.api.frontend_contract",
        "check",
    } <= {part for command in backend for part in command}
    assert {command[-1] for command in checks.commands("frontend")} == {
        "test",
        "typecheck",
        "lint",
        "build",
    }
    assert checks.commands("all") == [*backend, *checks.commands("frontend")]
    assert all("--locked" in command for command in backend)
    assert all(
        not any("manage." in argument or argument == "docker" for argument in command)
        for command in checks.commands("all")
    )


@pytest.mark.parametrize(("platform", "shell"), [("posix", True), ("nt", False), ("nt", True)])
def test_native_windows_gate_cannot_succeed_through_a_skipped_fixture(
    checks: ModuleType, monkeypatch: pytest.MonkeyPatch, platform: str, shell: bool
) -> None:
    monkeypatch.setattr(checks, "os", SimpleNamespace(name=platform))
    monkeypatch.setattr(
        checks, "shutil", SimpleNamespace(which=lambda _: "fixture" if shell else None)
    )
    if platform == "nt" and shell:
        command = checks.commands("native-windows")[0]
        assert "apps/server/tests/test_manage.py" in command
        assert "windows and not unix_setup_runtime_permissions" in command
    else:
        with pytest.raises(ValueError, match="Windows PowerShell"):
            checks.commands("native-windows")


def workflows() -> dict[str, dict]:
    return {
        path.name: yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
        for path in (ROOT / ".github/workflows").glob("*.yml")
    }


def test_workflows_have_pinned_actions_and_narrow_triggers_and_permissions(
    checks: ModuleType,
) -> None:
    documents = workflows()
    assert set(documents) == {"ci.yml", "prepare-version.yml", "release.yml"}
    for document in documents.values():
        assert document["permissions"] == {"contents": "read"}
        assert not {"pull_request_target", "workflow_run"} & document["on"].keys()
        for job in document["jobs"].values():
            if "uses" in job:
                assert job["uses"] == "./.github/workflows/ci.yml"
                continue
            assert "timeout-minutes" in job
            for step in job["steps"]:
                if "uses" not in step:
                    continue
                assert re.fullmatch(r"[^@]+@[a-f0-9]{40}", step["uses"])
                if step["uses"].startswith("actions/checkout@"):
                    assert step["with"]["persist-credentials"] == "false"
    ci = documents["ci.yml"]
    assert set(ci["on"]) == {"pull_request", "push", "workflow_call"}
    for event in ("pull_request", "push"):
        assert ci["on"][event] == {"branches": ["main"]}
    assert all("permissions" not in job for job in ci["jobs"].values())
    gate = ci["jobs"]["required"]
    assert gate["name"] == "Required Checks" and gate["if"] == "always()"
    assert set(gate["needs"]) == checks.REQUIRED_JOBS
    for job in checks.REQUIRED_JOBS:
        assert any(
            f"check.py {'native-windows' if job == 'windows' else job}" in step.get("run", "")
            for step in ci["jobs"][job]["steps"]
        )
    assert ci["concurrency"]["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"


def test_version_pr_uses_trusted_main_and_only_version_owned_paths(delivery: ModuleType) -> None:
    workflow = workflows()["prepare-version.yml"]
    assert set(workflow["on"]) == {"workflow_dispatch"}
    job = workflow["jobs"]["prepare"]
    assert job["if"] == "github.ref == 'refs/heads/main'"
    assert job["permissions"] == {"contents": "write", "pull-requests": "write"}
    assert job["steps"][0]["with"]["ref"] == "main"
    action = next(
        step
        for step in job["steps"]
        if step.get("uses", "").startswith("peter-evans/create-pull-request@")
    )
    options = action["with"]
    assert options["token"] == "${{ github.token }}" and options["base"] == "main"
    assert (
        options["branch"] == "release/v${{ inputs.version }}"
        and options["delete-branch"] == "false"
    )
    assert set(options["add-paths"].splitlines()) == {
        *delivery.PROJECTS,
        delivery.FRONTEND,
        delivery.CONTRACT,
        "backend/uv.lock",
    }
    assert all("${{ inputs.version }}" not in step.get("run", "") for step in job["steps"])
    assert workflow["concurrency"]["cancel-in-progress"] == "false"


def test_tag_release_reuses_checks_before_its_only_write_job() -> None:
    workflow = workflows()["release.yml"]
    assert workflow["on"] == {"push": {"tags": ["v*"]}}
    assert workflow["concurrency"]["cancel-in-progress"] == "false"
    jobs = workflow["jobs"]
    assert jobs["checks"]["uses"] == "./.github/workflows/ci.yml"
    assert jobs["checks"]["needs"] == "verify"
    assert set(jobs["publish"]["needs"]) == {"verify", "checks"}
    assert jobs["publish"]["permissions"] == {"contents": "write"}
    assert "permissions" not in jobs["verify"]
    for name in ("verify", "publish"):
        assert jobs[name]["steps"][0]["with"]["ref"] == "${{ github.sha }}"
        assert jobs[name]["steps"][0]["with"]["fetch-depth"] == "0"
    assert any("release.py verify-tag" in step.get("run", "") for step in jobs["verify"]["steps"])
    assert any("release.py publish" in step.get("run", "") for step in jobs["publish"]["steps"])
