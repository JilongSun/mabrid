.DEFAULT_GOAL := help
.PHONY: help install dev setup build run recreate stop
IMAGE ?= mabrid:local
CONTAINER_NAME ?= mabrid
PORT ?= 8765
CONFIG_DIR ?= .

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  install   Install backend and frontend dependencies"
	@echo "  dev       Start the whole project (backend + frontend)"
	@echo "  setup     Create mabrid.yaml, runtime/mabrid.runtime.yaml and optional .env"
	@echo "  build     Build the image after setup (IMAGE=mabrid:local)"
	@echo "  run       Start the built image with the local YAML configuration"
	@echo "  recreate  Apply static settings or changed process/container environment"
	@echo "  stop      Stop the managed container without deleting its data"
	@echo "  help      Show this help"

install:
	cd backend && uv sync --all-packages
	cd frontend && pnpm install

dev:
	cd backend && uv run --all-packages python ../scripts/dev.py

setup build run recreate stop:
	sh scripts/manage.sh $@ --config-dir "$(CONFIG_DIR)" --image "$(IMAGE)" --name "$(CONTAINER_NAME)" --port "$(PORT)"
