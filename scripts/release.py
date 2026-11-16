"""Maintain one product version and verify prepared source without changing Git history."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tomllib
from importlib.metadata import version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = (
    "backend/pyproject.toml",
    "backend/apps/server/pyproject.toml",
    "backend/packages/application/pyproject.toml",
    "backend/packages/bridge/pyproject.toml",
)
FRONTEND = "frontend/package.json"
CONTRACT = "docs/contracts/v0.1/frontend-contract.json"


def version_parts(value: str) -> tuple[int, ...]:
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", value):
        raise ValueError(
            "Version must be plain X.Y.Z without leading zeroes or prerelease suffixes"
        )
    return tuple(int(part) for part in value.split("."))


def projects(root: Path) -> dict[str, dict]:
    return {
        filename: tomllib.loads((root / filename).read_text(encoding="utf-8"))["project"]
        for filename in PROJECTS
    }


def check_versions(root: Path, *, installed: bool = True) -> str:
    metadata = projects(root)
    values = {filename: project["version"] for filename, project in metadata.items()}
    values[FRONTEND] = json.loads((root / FRONTEND).read_text(encoding="utf-8"))["version"]
    for value in values.values():
        version_parts(value)
    if len(set(values.values())) != 1:
        raise ValueError(f"Product metadata versions differ: {values}")
    expected = values[PROJECTS[0]]
    locked = tomllib.loads((root / "backend/uv.lock").read_text(encoding="utf-8"))
    packages = {package["name"]: package["version"] for package in locked["package"]}
    for project in metadata.values():
        name = project["name"]
        if packages.get(name) != expected:
            raise ValueError(f"Lockfile version differs for {name}; refresh backend/uv.lock")
        if installed and name != "mabrid-workspace" and version(name) != expected:
            raise ValueError(f"Installed version differs for {name}; run uv sync --all-packages")
    contract_version = json.loads((root / CONTRACT).read_text(encoding="utf-8"))["openapi"]["info"][
        "version"
    ]
    if contract_version != expected:
        raise ValueError("Frontend contract version differs; regenerate it after syncing packages")
    return expected


def run(command: list[str], root: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=root, capture_output=True, text=True, check=check)


def prepare_version(root: Path, target: str) -> None:
    target_parts = version_parts(target)
    current = check_versions(root, installed=False)
    if target_parts <= version_parts(current):
        raise ValueError("The target version must be greater than the current version")
    if run(["git", "status", "--porcelain", "--untracked-files=no"], root).stdout.strip():
        raise ValueError("Version preparation requires a clean tracked working tree")
    tag = f"v{target}"
    existing = run(
        ["git", "show-ref", "--verify", "--quiet", f"refs/tags/{tag}"], root, check=False
    )
    if existing.returncode == 0:
        raise ValueError(f"Tag already exists: {tag}")
    if existing.returncode != 1:
        raise ValueError("Could not check existing release tags")
    for filename, project in projects(root).items():
        command = ["uv", "version", "--directory", "backend", "--frozen"]
        if filename != PROJECTS[0]:
            command.extend(["--package", project["name"]])
        run([*command, target], root)
    frontend = root / FRONTEND
    document = json.loads(frontend.read_text(encoding="utf-8"))
    document["version"] = target
    frontend.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    run(["uv", "lock", "--directory", "backend"], root)
    run(["uv", "sync", "--directory", "backend", "--all-packages", "--locked"], root)
    run(
        [
            "uv",
            "run",
            "--directory",
            "backend",
            "--all-packages",
            "--locked",
            "python",
            "-m",
            "mabrid.server.api.frontend_contract",
            f"../{CONTRACT}",
        ],
        root,
    )
    check_versions(root, installed=False)


def verify_tag(root: Path, tag: str, main_ref: str = "origin/main") -> str:
    if not tag.startswith("v"):
        raise ValueError("Release tag must be vX.Y.Z")
    version_parts(tag[1:])
    if tag != f"v{check_versions(root)}":
        raise ValueError("Release tag does not match the prepared product version")
    head = run(["git", "rev-parse", "HEAD"], root).stdout.strip()
    tagged = run(["git", "rev-parse", f"refs/tags/{tag}^{{commit}}"], root).stdout.strip()
    if not re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", head) or head != tagged:
        raise ValueError("Checkout must identify the exact tagged commit")
    ancestor = run(["git", "merge-base", "--is-ancestor", head, main_ref], root, check=False)
    if ancestor.returncode != 0:
        raise ValueError("The tagged commit must belong to main history")
    return head


def publish_release(root: Path, tag: str) -> None:
    head = verify_tag(root, tag)
    pages = json.loads(
        run(
            ["gh", "api", "--paginate", "--slurp", "repos/{owner}/{repo}/releases?per_page=100"],
            root,
        ).stdout
    )
    for page in pages:
        for release in page:
            if release["tag_name"] != tag:
                continue
            if release["draft"] or release["prerelease"] or release["target_commitish"] != head:
                raise ValueError("Existing release does not match this public prepared release")
            print(f"Public release already exists; leaving it unchanged: {release['html_url']}")
            return
    result = run(
        [
            "gh",
            "release",
            "create",
            tag,
            "--verify-tag",
            "--target",
            head,
            "--title",
            f"Mabrid {tag}",
            "--generate-notes",
        ],
        root,
    )
    print(result.stdout.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="Check metadata, installed packages, lockfile, and contract")
    prepare = commands.add_parser("prepare", help="Prepare a maintainer-selected version locally")
    prepare.add_argument("version")
    verify = commands.add_parser("verify-tag", help="Verify tagged source and main ancestry")
    verify.add_argument("tag")
    publish = commands.add_parser("publish", help="Publish or confirm an unchanged GitHub Release")
    publish.add_argument("tag")
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            prepare_version(ROOT, args.version)
        elif args.command == "verify-tag":
            print(verify_tag(ROOT, args.tag))
        elif args.command == "publish":
            publish_release(ROOT, args.tag)
        else:
            print(check_versions(ROOT))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"{error}\n")
    except subprocess.CalledProcessError as error:
        parser.exit(1, f"Command failed: {error.cmd}\n{error.stderr or error.stdout}\n")


if __name__ == "__main__":
    main()
