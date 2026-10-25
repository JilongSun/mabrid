.DEFAULT_GOAL := install
.PHONY: install dev

install:
	uv sync --all-packages

dev:
	uv run --all-packages python -m mabrid.server.main
