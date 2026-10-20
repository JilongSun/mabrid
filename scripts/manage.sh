#!/bin/sh
set -eu

fail() { printf '%s\n' "$*" >&2; exit 1; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
action=${1:-}
if [ "$#" -gt 0 ]; then shift; fi
config_dir=$root/deploy/local
image=mabrid:local
name=mabrid
port=8765
timeout=90
while [ "$#" -gt 0 ]; do
    [ "$#" -ge 2 ] || fail "Missing value for $1"
    case "$1" in
        --config-dir) config_dir=$2 ;;
        --image) image=$2 ;;
        --name) name=$2 ;;
        --port) port=$2 ;;
        --timeout) timeout=$2 ;;
        *) fail "Unknown option: $1" ;;
    esac
    shift 2
done
case "$action" in setup|build|run|stop) ;; *) fail "Usage: manage.sh setup|build|run|stop [options]" ;; esac
case "$name" in ''|[!a-z0-9]*|*[!a-z0-9_-]*) fail "Use a lowercase Docker project name" ;; esac
case "$port" in ''|*[!0-9]*) fail "Port must be 1..65535" ;; esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || fail "Port must be 1..65535"
case "$timeout" in ''|*[!0-9]*) fail "Timeout must be a positive number of seconds" ;; esac
[ "$timeout" -gt 0 ] || fail "Timeout must be positive"

if [ "$action" = setup ]; then
    mkdir -p -- "$config_dir"
    for file in mabrid.yaml .env; do
        target=$config_dir/$file
        if [ -e "$target" ]; then
            [ -f "$target" ] || fail "Expected a regular file: $target"
            printf 'Keeping existing %s\n' "$target"
        else
            mode=644
            [ "$file" != .env ] || mode=600
            (umask 077; set -C; cat "$root/deploy/container/$file.example" > "$target")
            chmod "$mode" "$target"
            printf 'Created %s\n' "$target"
        fi
    done
    exit 0
fi

[ -d "$config_dir" ] || fail "Configuration directory is missing; run setup first"
config_dir=$(CDPATH= cd -- "$config_dir" && pwd -P)
if [ "$action" != stop ]; then
    [ -f "$config_dir/mabrid.yaml" ] && [ -f "$config_dir/.env" ] || fail "Run setup first"
fi
command -v docker >/dev/null 2>&1 || fail "Docker CLI is required"
[ "$(docker info --format '{{.OSType}}')" = linux ] || fail "Select a Docker context using Linux containers"
version=$(docker compose version --short) || fail "Docker Compose 2.30+ is required"
major=${version%%.*}
major=${major#v}
remainder=${version#*.}
minor=${remainder%%.*}
case "$major:$minor" in *[!0-9:]*) fail "Cannot identify the Docker Compose version" ;; esac
if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 30 ]; }; then
    fail "Docker Compose 2.30+ is required"
fi
case "$config_dir" in *,*) fail "Docker bind mount paths cannot contain commas" ;; esac
export MABRID_CONFIG_DIR="$config_dir" MABRID_IMAGE="$image" MABRID_NAME="$name" MABRID_PORT="$port"
compose() {
    docker compose --project-name "$name" --project-directory "$root" \
        --env-file "$root/deploy/container/.env.example" --file "$root/compose.yaml" "$@"
}
check_owner() {
    resource=$1
    object=$2
    if [ "$resource" = container ]; then
        exists=$(docker container ls --all --format '{{.Names}}')
    else
        exists=$(docker volume ls --format '{{.Name}}')
    fi
    if printf '%s\n' "$exists" | grep -Fx -- "$object" >/dev/null; then
        if [ "$resource" = container ]; then
            owner=$(docker container inspect --format '{{ index .Config.Labels "io.mabrid.config-directory" }}|{{ index .Config.Labels "com.docker.compose.project" }}' "$object")
        else
            owner=$(docker volume inspect --format '{{ index .Labels "io.mabrid.config-directory" }}|{{ index .Labels "com.docker.compose.project" }}' "$object")
        fi
        [ "$owner" = "$config_dir|$name" ] || fail "$resource $object is not owned by this deployment"
    fi
}

case "$action" in
    build)
        compose build mabrid
        ;;
    run)
        [ "$(docker image inspect --format '{{.Os}}' "$image" 2>/dev/null)" = linux ] || fail "Local image missing; run build first"
        check_owner container "$name"
        check_owner volume "$name-data"
        [ -z "$(compose ps --status running --quiet mabrid)" ] || fail "Already running; use stop before run"
        if ! compose run --rm --no-deps --pull never preflight >/dev/null 2>&1; then
            fail "Configuration preflight failed; check YAML/.env, required secrets, example URLs and volume paths. Values are not printed."
        fi
        compose up --detach --wait --wait-timeout "$timeout" --no-build --pull never mabrid
        printf 'Running %s at http://localhost:%s\n' "$name" "$port"
        ;;
    stop)
        check_owner container "$name"
        if [ -z "$(compose ps --status running --quiet mabrid)" ]; then
            printf '%s is already stopped; data is preserved.\n' "$name"
            exit 0
        fi
        compose stop --timeout 20 mabrid
        code=$(docker container inspect --format '{{.State.ExitCode}}' "$name")
        case "$code" in 0|143) ;; *) fail "Container did not stop gracefully; inspect Docker logs" ;; esac
        docker logs "$name" 2>&1 | grep -F 'Application shutdown complete.' >/dev/null || fail "Application shutdown completion was not verified"
        printf 'Stopped %s; volume %s-data is preserved.\n' "$name" "$name"
        ;;
esac