#!/usr/bin/env bash
# CI-only PostgreSQL 16 client shim. Uses the same pinned image as the
# disposable PostgreSQL service. Prevents OS apt repository version drift.
set -euo pipefail
binary="$(basename "$0")"
case "$binary" in
  pg_dump|pg_restore) ;;
  *) echo "Unsupported database client" >&2; exit 2 ;;
esac
if [[ "${CV_ALLOW_CI_SEED:-}" != "1" || ( "${PGHOST:-}" != "localhost" && "${PGHOST:-}" != "127.0.0.1" ) ]]; then
  echo "Refusing Docker PostgreSQL client outside local disposable CI" >&2
  exit 2
fi
exec docker run --rm --network host \
  --mount type=bind,source=/tmp,target=/tmp,readonly \
  --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD \
  --env PGDATABASE --env PGSSLMODE \
  postgres:16 "$binary" "$@"
