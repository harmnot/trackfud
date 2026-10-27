#!/usr/bin/env bash
# Trackfud Milestone 1 — plain Podman (no compose provider needed).
# Usage: bash scripts/podman-up.sh [--down]
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--down" ]]; then
  podman rm -f tb-gateway tb-merchant tb-courier tb-customer tb-backend tb-mailpit tb-db 2>/dev/null || true
  echo "Stopped. Volumes kept (tb_pgdata, tb_uploads). Remove with: podman volume rm tb_pgdata tb_uploads"
  exit 0
fi

podman network exists tb-net || podman network create tb-net
podman volume exists tb_pgdata || podman volume create tb_pgdata
podman volume exists tb_uploads || podman volume create tb_uploads

echo "==> Building images"
podman build -t tb-backend ./backend
podman build -t tb-customer ./frontend-customer
podman build -t tb-courier ./frontend-runner-biker
podman build -t tb-merchant ./frontend-merchant

echo "==> Starting Postgres (PostGIS 18-3.6) + Mailpit"
podman rm -f tb-db tb-mailpit tb-backend tb-customer tb-courier tb-merchant tb-gateway 2>/dev/null || true
podman run -d --name tb-db --network tb-net -e POSTGRES_USER=Trackfud -e POSTGRES_PASSWORD=Trackfud -e POSTGRES_DB=Trackfud -p 5432:5432 -v tb_pgdata:/var/lib/postgresql docker.io/postgis/postgis:18-3.6
podman run -d --name tb-mailpit --network tb-net -p 8025:8025 -p 1025:1025 docker.io/axllent/mailpit:latest

echo "==> Waiting for Postgres"
for i in $(seq 1 30); do
  if podman exec tb-db pg_isready -U Trackfud >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "==> Starting backend + frontends + gateway"
podman run -d --name tb-backend --network tb-net -e DATABASE_URL=postgres://Trackfud:Trackfud@tb-db:5432/Trackfud?sslmode=disable -e TB_JWT_SECRET=dev-only-change-me-32chars-minimum!! -e TB_SMTP_HOST=tb-mailpit -e TB_DEMO_MODE=true -p 8081:8080 -v tb_uploads:/data/uploads tb-backend
podman run -d --name tb-customer --network tb-net tb-customer
podman run -d --name tb-courier --network tb-net tb-courier
podman run -d --name tb-merchant --network tb-net tb-merchant
podman run -d --name tb-gateway --network tb-net -p 8000:80 -v "$PWD/gateway/Caddyfile:/etc/caddy/Caddyfile:ro" docker.io/library/caddy:2

echo ""
echo "Trackfud is up:"
echo "  Customer  http://localhost:8000/customer/"
echo "  Courier   http://localhost:8000/courier/"
echo "  Merchant  http://localhost:8000/merchant/"
echo "  API docs health  http://localhost:8000/api/healthz  (direct: http://localhost:8081/healthz)"
echo "  Mailpit   http://localhost:8025"
echo "Logs: podman logs -f tb-backend"
