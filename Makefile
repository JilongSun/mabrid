.DEFAULT_GOAL := help
.PHONY: help install dev oci-build oci-check
IMAGE ?= mabrid:local

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  install   Install backend and frontend dependencies"
	@echo "  dev       Start the whole project (backend + frontend)"
	@echo "  oci-build Build the production OCI image (IMAGE=mabrid:local)"
	@echo "  oci-check Check the image using isolated containers and storage"
	@echo "  help      Show this help"

install:
	cd backend && uv sync --all-packages
	cd frontend && pnpm install

dev:
	cd backend && uv run --all-packages python ../scripts/dev.py

oci-build:
	uv run --directory backend --no-project python ../scripts/oci.py build --image "$(IMAGE)"

oci-check:
	uv run --directory backend --no-project python ../scripts/oci.py check --image "$(IMAGE)"
