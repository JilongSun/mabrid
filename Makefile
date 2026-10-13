.DEFAULT_GOAL := help
.PHONY: help install dev

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  install   Install backend and frontend dependencies"
	@echo "  dev       Start the whole project (backend + frontend)"
	@echo "  help      Show this help"

install:
	cd backend && uv sync --all-packages
	cd frontend && pnpm install

dev:
	cd backend && uv run --all-packages python ../scripts/dev.py
