#!/usr/bin/env bash
# Runs the pinned Supabase CLI (scripts/supabase-cli.sh) with the arguments given, for the
# `npm run db:*` scripts: `scripts/supabase.sh db reset`. Stops before running anything when the
# CLI found isn't the pinned version.
set -euo pipefail
. "$(dirname "$0")/supabase-cli.sh"
exec supabase "$@"
