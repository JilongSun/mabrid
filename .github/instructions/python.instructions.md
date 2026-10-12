---
description: "Stable Python tooling, typing, async, and test conventions for backend packages and applications."
applyTo: ["**/*.py"]
---
# Python Backend Guidelines

## Tooling

- Use `uv` for all dependency and environment operations.
- Run tests with `uv run --all-packages pytest`, lint with `uv run ruff check`, and type-check
	with `uv run pyright` from `backend/`.
- Format changed Python files with `uv run ruff format`.
- Prefer `uv add <package>` and `uv remove <package>` for dependency changes.
- Authoritative configuration lives in `pyproject.toml`, not scattered across setup.cfg and requirements files.
- Prefer mature SDKs and established Python packages when they fit the requirement well. Avoid writing custom protocol, transport, or validation plumbing when a stable package already solves it.

## Type Discipline

- Use project-owned typed models at package boundaries; use Pydantic v2 where runtime validation or
	serialization is required.
- Avoid passing raw dictionaries or unstructured tuples across module boundaries.
- Use `typing.Protocol` or ABCs for adapter interfaces, not concrete implementations.
- Use `pathlib.Path` and portable path operations rather than OS-specific string concatenation or hardcoded filesystem separators.

## Architecture Documentation

- Give every production class a concise English docstring. Keep simple data contracts brief;
	explain lifecycle, ownership, and non-obvious invariants for services and adapters.
- For Protocols and structural implementations, name the contract, matching methods/properties,
	and the actual consumer or composition site. Distinguish structural conformance from inheritance;
	document callable factories and reader views when they fulfill a port without a base class.
- Navigation is implementation-to-contract: give each concrete contract-facing method or property
	a direct `[PortName.method](../ports.py:42)` reference to its declaring Protocol member, including
	private/composed observers and inherited implementations. Class references do not replace method
	references. Link all applicable reader/writer views; use the original declaring Protocol for an
	inherited member. Do not build a reverse implementation index in Protocol documentation.
- Verify the complete signature, return/event shape, typed consumer, and actual injection before
	claiming conformance. Distinguish implementations from consumers, forwarding facades, and partial
	base classes. Same method names or compatible shapes alone do not establish design intent.
- Use source references such as `[PortName](../ports.py:42)` in Python docstrings, relative to the
	documenting file, with the named declaration's current 1-based line number. Architecture tests
	verify both the symbol and its line; update incoming references when a declaration moves.
	The recommended Comment Linker extension provides Ctrl+Click on these labels in Python source.
	This is extension-backed file navigation, not Pylance/F12 symbol resolution or inheritance.
	Without that extension, use architecture Markdown links or existing code identifiers. Do not
	infer clickable navigation from hover Markdown alone or use machine-specific absolute paths.
- Do not add imports, base classes, wrappers, or runtime behavior solely for documentation. Follow
	the existing Protocol pattern and public facade boundaries.
- Class docstrings can change Pydantic schema descriptions. Check that fields and validation stay
	unchanged and refresh an affected frozen contract snapshot as documentation metadata only.

## Async Model

- Use `anyio` or `asyncio` explicitly; do not mix threading primitives without deliberate isolation.
- Long-running bridge loops or MCP client sessions run on their own dedicated tasks.
- Prefer structured concurrency patterns (task groups, scoped cancellation) over bare `asyncio.create_task`.
- Keep sync and async boundaries predictable: a function should be entirely sync or entirely async, not both depending on a runtime flag.

## Testing

- Keep tests narrow and close to the behavior being changed.
- Use pytest with the repository's configured async support.
- Prefer controlled fixtures over live agents or MCP servers.
