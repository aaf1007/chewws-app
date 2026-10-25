#!/usr/bin/env bash
# Fails when src/data/database.types.ts doesn't match the local database's schema.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! supabase gen types typescript --local >"$tmp" 2>/dev/null; then
  echo "Could not generate types. Is local Supabase running? Start it with npm run db:start." >&2
  exit 1
fi

if ! diff -q "$tmp" src/data/database.types.ts >/dev/null; then
  diff -u src/data/database.types.ts "$tmp" | head -40 >&2 || true
  echo "src/data/database.types.ts is stale: run npm run db:types" >&2
  exit 1
fi
echo "database.types.ts is fresh"
