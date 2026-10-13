default:
    @just --list

install:
    cd backend && uv sync --all-packages
    cd frontend && pnpm install

dev:
    cd backend && uv run --all-packages python ../scripts/dev.py