"""Debug entry point for the bridge runtime.

This module intentionally mirrors the normal runtime entry point so debugger
launches exercise the exact same configuration and startup path as `main.py`.

Edit ``_DEBUG_CONFIG`` below to select a configuration file without touching
launch.json. All other settings come from the YAML file.
"""

from __future__ import annotations

import sys

from mabrid.server.logging import LogMode, configure_logging

configure_logging(LogMode.DEBUG)

# ── Debug overrides — edit this line ─────────────────────────────────────
_DEBUG_CONFIG: str | None = None  # e.g. "mabrid.yaml"
# ─────────────────────────────────────────────────────────────────────────

from mabrid.server.main import main  # noqa: E402

if __name__ == "__main__":
    argv = list(sys.argv[1:])
    if _DEBUG_CONFIG is not None:
        argv.extend(["--config", _DEBUG_CONFIG])
    sys.argv = [sys.argv[0], *argv]
    main()
