#!/usr/bin/env bash
# Trackfud — standalone image builds, one service at a time (or all).
#
#   bash scripts/build.sh [service ...]
#
# Services (aliases accepted):
#   backend                  → tf-backend        (./backend)
#   cms-admin | cms | back-office | admin → tf-back-office (./frontend-cms-admin)
#   customer                 → tf-customer       (./frontend-customer)
#   courier | runner | biker → tf-courier        (./frontend-runner-biker)
#   merchant                 → tf-merchant       (./frontend-merchant)
#   all                      → every image above (default when no args given)
#
# Examples:
#   bash scripts/build.sh backend
#   bash scripts/build.sh courier
#   bash scripts/build.sh courier merchant
#   bash scripts/build.sh            # same as: bash scripts/build.sh all
#
# Frontend VITE_* values come from each app's .env file (same rule as
# podman-up.sh); backend needs no build args. Pair with podman-up.sh to run:
# build first, then `bash scripts/podman-up.sh` reuses the images it just built.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source scripts/lib.sh

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
}

build_backend() {
  echo "---- backend (tf-backend) ----"
  podman build -t tf-backend ./backend
}

build_frontend() {
  local name="$1" dir="$2" image="$3" env_file="$4"
  echo "---- ${name} (${image}) ----"
  local build_args=()
  mapfile -t build_args < <(build_args_from_env "$env_file")
  if [[ ${#build_args[@]} -gt 0 ]]; then
    echo "    using ${env_file}"
    podman build "${build_args[@]}" -t "$image" "$dir"
  else
    podman build -t "$image" "$dir"
  fi
}

build_one() {
  case "$1" in
    backend)
      build_backend
      ;;
    cms-admin|cms|back-office|backoffice|admin)
      build_frontend "frontend back-office" ./frontend-cms-admin tf-back-office frontend-cms-admin/.env
      ;;
    customer)
      build_frontend "frontend customer" ./frontend-customer tf-customer frontend-customer/.env
      ;;
    courier|runner|biker)
      build_frontend "frontend courier" ./frontend-runner-biker tf-courier frontend-runner-biker/.env
      ;;
    merchant)
      build_frontend "frontend merchant" ./frontend-merchant tf-merchant frontend-merchant/.env
      ;;
    all)
      build_one backend
      build_one cms-admin
      build_one customer
      build_one courier
      build_one merchant
      ;;
    -h|--help|help)
      usage
      ;;
    --list)
      printf '%s\n' backend cms-admin customer courier merchant all
      ;;
    *)
      echo "error: unknown service '$1'" >&2
      echo "valid: backend cms-admin customer courier merchant all (try --list)" >&2
      exit 1
      ;;
  esac
}

if [[ $# -eq 0 ]]; then
  set -- all
fi

# Help/list short-circuit before any build runs.
for arg in "$@"; do
  case "$arg" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --list)
      printf '%s\n' backend cms-admin customer courier merchant all
      exit 0
      ;;
  esac
done

for svc in "$@"; do
  build_one "$svc"
done

echo ""
echo "Built OK. Run everything with: bash scripts/podman-up.sh"
