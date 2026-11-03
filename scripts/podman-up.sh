#!/usr/bin/env bash
# Trackfud — plain Podman (no compose provider needed).
# All config comes from dotenv files, not hardcoded constants:
#   backend/.env                → backend runtime (DATABASE_URL, TF_*, POSTGRES_*)
#   frontend-*/.env             → frontend build-time (VITE_*)
#   optional .env at repo root  → overrides / compose-style defaults
# Usage: bash scripts/podman-up.sh [--down]
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT_ENV=".env"
BACKEND_ENV="backend/.env"
BACK_OFFICE_ENV="frontend-cms-admin/.env"
CUSTOMER_ENV="frontend-customer/.env"
COURIER_ENV="frontend-runner-biker/.env"
MERCHANT_ENV="frontend-merchant/.env"

# --- helpers ---------------------------------------------------------------
# Shared with scripts/build.sh (single copy lives in scripts/lib.sh).
# shellcheck disable=SC1091
source scripts/lib.sh

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    echo "==> Loading $file"
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  else
    echo "WARN: $file not found — using defaults/env" >&2
  fi
}

# Replace localhost/127.0.0.1/db host in a postgres URL with the container host.
remap_db_url() {
  local url="$1"
  local host="$2"
  # postgres://user:pass@host:port/db?params → replace host part after @
  printf '%s' "$url" | sed -E "s/@(localhost|127\.0\.0\.1|db|tf-db)(:[0-9]+)?/@${host}\2/"
}

# --- --down ---------------------------------------------------------------

if [[ "${1:-}" == "--down" ]]; then
  podman rm -f tf-gateway tf-merchant tf-courier tf-customer tf-backend tf-mailpit tf-db 2>/dev/null || true
  echo "Stopped. Volumes kept (tf_pgdata, tf_uploads). Remove with: podman volume rm tf_pgdata tf_uploads"
  exit 0
fi

# --- load environment -----------------------------------------------------

# Root .env first (if present) — allows project-wide overrides
if [[ -f "$ROOT_ENV" ]]; then
  load_env_file "$ROOT_ENV"
fi
# Backend env is the source of truth for DB/auth/TF_* at runtime
load_env_file "$BACKEND_ENV"

# Defaults — only used when neither .env nor shell provides a value.
: "${POSTGRES_USER:=Trackfud}"
: "${POSTGRES_PASSWORD:=Trackfud}"
: "${POSTGRES_DB:=Trackfud}"
: "${DB_PORT:=5432}"
: "${MAILPIT_UI_PORT:=8025}"
: "${MAILPIT_SMTP_PORT:=1025}"
: "${BACKEND_PORT:=8081}"
: "${GATEWAY_PORT:=8000}"
: "${TF_JWT_SECRET:=dev-only-change-me-32chars-minimum!!}"
# Canonical env switch: APP_DEVELOPMENT=production → production mode (no demo
# shortcuts). TF_DEMO_MODE only defaults when not explicitly set, so an
# explicit TF_DEMO_MODE still wins (compat with existing .env files).
: "${APP_DEVELOPMENT:=}"
if [[ -z "${TF_DEMO_MODE:-}" ]]; then
  if [[ "$APP_DEVELOPMENT" == "production" ]]; then TF_DEMO_MODE=false; else TF_DEMO_MODE=true; fi
fi
: "${TF_SMTP_HOST:=localhost}"
: "${TF_SMTP_PORT:=1025}"
: "${DATABASE_URL:=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${DB_PORT}/${POSTGRES_DB}?sslmode=disable}"
# Host/local dev upload dir stays relative; container will force /data/uploads (see below)

# Remap localhost hosts to podman network names (tf-db / tf-mailpit)
CONTAINER_DB_URL="$(remap_db_url "$DATABASE_URL" "tf-db")"
if [[ "$TF_SMTP_HOST" == "localhost" || "$TF_SMTP_HOST" == "127.0.0.1" ]]; then
  CONTAINER_SMTP_HOST="tf-mailpit"
else
  CONTAINER_SMTP_HOST="$TF_SMTP_HOST"
fi

# Pass through remaining TF_* / AI / payment keys from backend env if set
# (they are already exported via load_env_file). Ensure empty vars don't
# produce literal empty --env flags later by handling conditionally.

podman network exists tf-net || podman network create tf-net
podman volume exists tf_pgdata || podman volume create tf_pgdata
podman volume exists tf_uploads || podman volume create tf_uploads

# --- build ---------------------------------------------------------------

echo "==> Building images"

echo "---- backend ----"
podman build -t tf-backend ./backend

echo "---- frontend back-office ----"
mapfile -t BACK_OFFICE_ARGS < <(build_args_from_env "$BACK_OFFICE_ENV")
if [[ ${#BACK_OFFICE_ARGS[@]} -gt 0 ]]; then
  echo "    using ${CUSTOMER_ENV}: ${BACK_OFFICE_ARGS[*]}"
  podman build "${BACK_OFFICE_ARGS[@]}" -t tf-back-office ./frontend-cms-admin
else
  podman build -t tf-back-office ./frontend-cms-admin
fi

echo "---- frontend customer ----"
mapfile -t CUSTOMER_ARGS < <(build_args_from_env "$CUSTOMER_ENV")
if [[ ${#CUSTOMER_ARGS[@]} -gt 0 ]]; then
  echo "    using ${CUSTOMER_ENV}: ${CUSTOMER_ARGS[*]}"
  podman build "${CUSTOMER_ARGS[@]}" -t tf-customer ./frontend-customer
else
  podman build -t tf-customer ./frontend-customer
fi

echo "---- frontend courier ----"
mapfile -t COURIER_ARGS < <(build_args_from_env "$COURIER_ENV")
if [[ ${#COURIER_ARGS[@]} -gt 0 ]]; then
  echo "    using ${COURIER_ENV}: ${COURIER_ARGS[*]}"
  podman build "${COURIER_ARGS[@]}" -t tf-courier ./frontend-runner-biker
else
  podman build -t tf-courier ./frontend-runner-biker
fi

echo "---- frontend merchant ----"
mapfile -t MERCHANT_ARGS < <(build_args_from_env "$MERCHANT_ENV")
if [[ ${#MERCHANT_ARGS[@]} -gt 0 ]]; then
  echo "    using ${MERCHANT_ENV}: ${MERCHANT_ARGS[*]}"
  podman build "${MERCHANT_ARGS[@]}" -t tf-merchant ./frontend-merchant
else
  podman build -t tf-merchant ./frontend-merchant
fi

# --- run -----------------------------------------------------------------

echo "==> Starting Postgres (PostGIS 18-3.6) + Mailpit"
podman rm -f tf-db tf-mailpit tf-back-office tf-backend tf-customer tf-courier tf-merchant tf-gateway 2>/dev/null || true
podman run -d --name tf-db --network tf-net \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -p "${DB_PORT}:5432" -v tf_pgdata:/var/lib/postgresql docker.io/postgis/postgis:18-3.6
podman run -d --name tf-mailpit --network tf-net \
  -p "${MAILPIT_UI_PORT}:8025" -p "${MAILPIT_SMTP_PORT}:1025" docker.io/axllent/mailpit:latest

echo "==> Waiting for Postgres"
for _ in $(seq 1 30); do
  if podman exec tf-db pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "==> Starting backend + frontends + gateway"

# Collect backend -e flags dynamically from loaded env (only set non-empty ones
# beyond the mandatory remapped hosts). This keeps secrets out of the script.
# TF_UPLOAD_DIR/TF_CONFIG/TF_MIGRATIONS_DIR are forced to container absolute
# paths — never forward the host-relative values from .env.
BACKEND_ENV_FLAGS=(
  -e "DATABASE_URL=${CONTAINER_DB_URL}"
  -e "TF_JWT_SECRET=${TF_JWT_SECRET}"
  -e "TF_SMTP_HOST=${CONTAINER_SMTP_HOST}"
  -e "TF_SMTP_PORT=${TF_SMTP_PORT}"
  -e "TF_DEMO_MODE=${TF_DEMO_MODE}"
  -e "APP_DEVELOPMENT=${APP_DEVELOPMENT}"
  -e "TF_UPLOAD_DIR=/data/uploads"
  -e "TF_CONFIG=/app/config.yaml"
  -e "TF_MIGRATIONS_DIR=/app/db/migrations"
)
# Optional keys — forward only if present (empty means offline fallback by design)
for key in TF_GOOGLE_MAPS_KEY TF_PADDLE_WEBHOOK_SECRET TF_MODAL_KEY TF_MODAL_SECRET \
           TF_META_API_KEY TF_META_BASE_URL TF_META_SPARK_MODEL TF_META_CONTRIBUTOR_MODEL \
           TF_META_TRANSCRIBE_MODEL TF_META_SAM_MODEL TF_PAYMENTS_PROVIDER TF_ADDR \
           TF_PUBLIC_BASE_URL TF_IDENC_KEY \
           TF_R2_ENDPOINT TF_R2_ACCESS_KEY TF_R2_SECRET_KEY \
           TF_R2_PUBLIC_BUCKET TF_R2_PRIVATE_BUCKET TF_R2_PUBLIC_URL \
           TF_SMTP_USER TF_SMTP_PASSWORD TF_SMTP_FROM \
           TF_VAPID_PUBLIC_KEY TF_VAPID_PRIVATE_KEY TF_VAPID_SUBJECT \
           TF_PADDLE_API_KEY TF_PADDLE_ENV TF_PADDLE_CLIENT_TOKEN; do
  val="${!key:-}"
  if [[ -n "$val" ]]; then
    BACKEND_ENV_FLAGS+=(-e "${key}=${val}")
  fi
done

podman run -d --name tf-backend --network tf-net \
  "${BACKEND_ENV_FLAGS[@]}" \
  -p "${BACKEND_PORT}:8080" -v tf_uploads:/data/uploads tf-backend
podman run -d --name tf-back-office --network tf-net tf-back-office
podman run -d --name tf-customer --network tf-net tf-customer
podman run -d --name tf-courier --network tf-net tf-courier
podman run -d --name tf-merchant --network tf-net tf-merchant
podman run -d --name tf-gateway --network tf-net -p "${GATEWAY_PORT}:80" -v "$PWD/gateway/Caddyfile:/etc/caddy/Caddyfile:ro" docker.io/library/caddy:2

echo ""
echo "Trackfud is up:"
echo "  CMS Admin http://localhost:${GATEWAY_PORT}/back-office/"
echo "  Customer  http://localhost:${GATEWAY_PORT}/customer/"
echo "  Courier   http://localhost:${GATEWAY_PORT}/courier/"
echo "  Merchant  http://localhost:${GATEWAY_PORT}/merchant/"
echo "  API docs health  http://localhost:${GATEWAY_PORT}/api/healthz  (direct: http://localhost:${BACKEND_PORT}/healthz)"
echo "  Mailpit   http://localhost:${MAILPIT_UI_PORT}"
echo "Logs: podman logs -f tf-backend"
