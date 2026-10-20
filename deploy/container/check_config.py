"""Validate mounted deployment settings inside the image without opening runtime resources."""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlsplit

from mabrid.server.config import ConfigError, resolve_runtime_configuration


def main() -> int:
    try:
        config = resolve_runtime_configuration(
            "/etc/mabrid/mabrid.yaml",
            upstream_name=None,
            api_host="0.0.0.0",
            api_port=8765,
            proxy_name=None,
        )
        path = config.storage.sqlite_path.resolve()
        if path == Path("/var/lib/mabrid") or not path.is_relative_to("/var/lib/mabrid"):
            raise ValueError("Storage must be inside the persistent volume")
        if any(
            (urlsplit(upstream.url).hostname or "").endswith(".invalid")
            for upstream in config.upstreams.values()
            if upstream.url
        ):
            raise ValueError("Replace example upstream URLs before running")
    except (ConfigError, ValueError, OSError):
        print(
            "Configuration validation failed. Check YAML, required secret references, "
            "example upstream URLs, and storage.sqlitePath under /var/lib/mabrid. "
            "Values are not printed.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
