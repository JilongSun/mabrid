default:
    @just --list

image := "mabrid:local"

install:
    cd backend && uv sync --all-packages
    cd frontend && pnpm install

dev:
    cd backend && uv run --all-packages python ../scripts/dev.py

oci-build:
    uv run --directory backend --no-project python ../scripts/oci.py build --image "{{image}}"

oci-check:
    uv run --directory backend --no-project python ../scripts/oci.py check --image "{{image}}"