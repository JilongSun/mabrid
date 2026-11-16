"""Export deployment-file schemas offline; semantic validation remains owned by the loader."""

import argparse
import json
from pathlib import Path
from typing import cast

from pydantic import JsonValue

from .file import ProcessFileConfig, RuntimeFileConfig


def configuration_schemas() -> dict[str, dict[str, JsonValue]]:
    return {
        filename: cast(
            dict[str, JsonValue],
            {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                **model.model_json_schema(mode="validation", by_alias=True),
            },
        )
        for filename, model in (
            ("mabrid.schema.json", ProcessFileConfig),
            ("mabrid.runtime.schema.json", RuntimeFileConfig),
        )
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export or check deployment configuration schemas."
    )
    parser.add_argument("output", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for filename, document in configuration_schemas().items():
        output = args.output / filename
        if args.check:
            try:
                matches = json.loads(output.read_text(encoding="utf-8")) == document
            except (OSError, ValueError):
                matches = False
            if not matches:
                parser.exit(
                    1, f"Configuration schema differs from the committed snapshot: {filename}\n"
                )
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(
                json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )


if __name__ == "__main__":
    main()
