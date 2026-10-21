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
	@echo "  setup     Copy mabrid.yaml.example to mabrid.yaml if missing"
	@echo "  build     Build the image after setup (IMAGE=mabrid:local)"
	@echo "  run       Start the built image with the local YAML configuration"
	@echo "  recreate  Replace the container so changed .env values take effect"
	@echo "  stop      Stop the managed container without deleting its data"
	@echo "  help      Show this help"

install:
	cd backend && uv sync --all-packages
	cd frontend && pnpm install

dev:
	cd backend && uv run --all-packages python ../scripts/dev.py

setup build run recreate stop:
	sh scripts/manage.sh $@ --config-dir "$(CONFIG_DIR)" --image "$(IMAGE)" --name "$(CONTAINER_NAME)" --port "$(PORT)"
