set shell := ["sh", "-eu", "-c"]
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]

default:
    @just --list

image := "mabrid:local"
name := "mabrid"
port := "8765"
config_dir := "deploy/local"

[unix]
install:
    uv sync --directory backend --all-packages
    pnpm --dir frontend install

[windows]
install:
    uv sync --directory backend --all-packages
    pnpm.cmd --dir frontend install

dev:
    uv run --directory backend --all-packages python ../scripts/dev.py

[unix]
setup:
    sh scripts/manage.sh setup --config-dir "{{config_dir}}" --image "{{image}}" --name "{{name}}" --port "{{port}}"

[unix]
build:
    sh scripts/manage.sh build --config-dir "{{config_dir}}" --image "{{image}}" --name "{{name}}" --port "{{port}}"

[unix]
run:
    sh scripts/manage.sh run --config-dir "{{config_dir}}" --image "{{image}}" --name "{{name}}" --port "{{port}}"

[unix]
stop:
    sh scripts/manage.sh stop --config-dir "{{config_dir}}" --image "{{image}}" --name "{{name}}" --port "{{port}}"

[windows]
setup:
    & ./scripts/manage.ps1 setup -ConfigDir "{{config_dir}}" -Image "{{image}}" -Name "{{name}}" -Port {{port}}

[windows]
build:
    & ./scripts/manage.ps1 build -ConfigDir "{{config_dir}}" -Image "{{image}}" -Name "{{name}}" -Port {{port}}

[windows]
run:
    & ./scripts/manage.ps1 run -ConfigDir "{{config_dir}}" -Image "{{image}}" -Name "{{name}}" -Port {{port}}

[windows]
stop:
    & ./scripts/manage.ps1 stop -ConfigDir "{{config_dir}}" -Image "{{image}}" -Name "{{name}}" -Port {{port}}