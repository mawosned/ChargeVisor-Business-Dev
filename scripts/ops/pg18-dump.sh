#!/usr/bin/env bash
# Production-safe pg_dump 18 launcher; no password in arguments or logs.
# For GitHub Actions/Linux with Docker. Output is streamed to stdout and
# immediately encrypted by scripts/ops/database-archive.mjs.
set -euo pipefail
if [[ "${CV_ALLOW_PRODUCTION_BACKUP:-}" != "YES_ENCRYPTED_ONLY" ]]; then
  echo "PG18 production backup requires an explicit encrypted-job flag" >&2
  exit 2
fi
if [[ -z "${PGHOST:-}" || -z "${PGDATABASE:-}" || -z "${PGUSER:-}" || -z "${PGPASSWORD:-}" ]]; then
  echo "Missing PostgreSQL connection settings" >&2
  exit 2
fi
exec docker run --rm \
  --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD \
  --env PGDATABASE --env PGSSLMODE --env PGCONNECT_TIMEOUT \
  postgres:18 pg_dump "$@"
