"""Shared, service-free development and CI gates; never invoke real deployment operations."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_JOBS = {"backend", "frontend", "windows"}
UV = ["uv", "run", "--directory", str(ROOT / "backend"), "--all-packages", "--locked"]


def check_gate(results: dict[str, dict[str, str]]) -> None:
    if set(results) != REQUIRED_JOBS or any(
        job.get("result") != "success" for job in results.values()
    ):
        raise ValueError(
            "Every required job must finish successfully; missing or skipped jobs fail"
        )


def commands(scope: str) -> list[list[str]]:
    if scope == "contracts":
        return [
            [
                *UV,
                "python",
                "-m",
                "mabrid.server.api.frontend_contract",
                "../docs/contracts/v0.1/frontend-contract.json",
                "--check",
            ],
            [
                *UV,
                "python",
                "-m",
                "mabrid.server.config.schema",
                "../docs/contracts/configuration",
                "--check",
            ],
        ]
    if scope == "versions":
        return [[*UV, "python", str(ROOT / "scripts/release.py"), "check"]]
    if scope == "backend":
        tooling = [str(ROOT / "scripts/check.py"), str(ROOT / "scripts/release.py")]
        return [
            [*UV, "pytest", "-q", "--tb=short"],
            [*UV, "pyright"],
            [*UV, "ruff", "check", ".", *tooling],
            [*UV, "ruff", "format", "--check", ".", *tooling],
            *commands("contracts"),
            *commands("versions"),
        ]
    if scope == "frontend":
        pnpm = shutil.which("pnpm") or "pnpm"
        return [
            [pnpm, "--dir", str(ROOT / "frontend"), task]
            for task in ("test", "typecheck", "lint", "build")
        ]
    if scope == "native-windows":
        if os.name != "nt" or shutil.which("powershell.exe") is None:
            raise ValueError(
                "Native Windows checks require Windows PowerShell, not a skipped fixture"
            )
        return [
            [
                *UV,
                "pytest",
                "apps/server/tests/test_manage.py",
                "-k",
                "windows and not unix_setup_runtime_permissions",
                "-q",
                "--tb=short",
            ]
        ]
    if scope == "all":
        return [*commands("backend"), *commands("frontend")]
    raise ValueError(f"Unknown check scope: {scope}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "scope",
        nargs="?",
        default="all",
        choices=["all", "backend", "frontend", "contracts", "versions", "native-windows", "gate"],
    )
    args = parser.parse_args()
    try:
        if args.scope == "gate":
            check_gate(json.loads(os.environ["CHECK_RESULTS"]))
            return
        for command in commands(args.scope):
            print(f"$ {shlex.join(command)}", flush=True)
            subprocess.run(command, cwd=ROOT, check=True)
    except (ValueError, KeyError) as error:
        parser.exit(1, f"{error}\n")
    except subprocess.CalledProcessError as error:
        parser.exit(error.returncode, "Check failed.\n")


if __name__ == "__main__":
    main()
