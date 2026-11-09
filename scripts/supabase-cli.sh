#!/usr/bin/env bash
# Sourced (`. scripts/supabase-cli.sh`) by every script that runs the Supabase CLI. Puts this repo's
# CLI (the `supabase` devDependency, pinned exactly in package.json, the same version CI installs in
# .github/workflows/verify.yml) first on PATH, and stops at once when the `supabase` that resolves
# isn't that version. A different CLI generates different database types and can pull new images
# on `db reset`, which once wiped the local database and then hung (ticket 15).
supabase_cli_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="$supabase_cli_root/node_modules/.bin:$PATH"
supabase_cli_pinned="$(node -p "require('$supabase_cli_root/package.json').devDependencies.supabase")"
supabase_cli_found="$(supabase --version 2>/dev/null || echo 'none')"
if [ "$supabase_cli_found" != "$supabase_cli_pinned" ]; then
  echo "Supabase CLI $supabase_cli_found found ($(command -v supabase || echo 'not on PATH')), but this repo pins $supabase_cli_pinned." >&2
  echo "Run npm install (the pinned CLI is the supabase devDependency), then try again." >&2
  exit 1
fi
