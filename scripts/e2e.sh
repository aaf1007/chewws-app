#!/usr/bin/env bash
# Runs the Maestro flows, each against a freshly reset local database: every flow starts with the
# seeded dev user and nothing else, whatever ran before it. Pass flow files to run only those:
#   scripts/e2e.sh .maestro/dev-sign-in-and-out.yaml
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -gt 0 ]; then
  flows=("$@")
else
  flows=(.maestro/*.yaml)
fi

failed=()
for flow in "${flows[@]}"; do
  echo "== $flow: resetting the local database"
  if ! out="$(supabase db reset 2>&1)"; then
    echo "$out" >&2
    echo "supabase db reset failed. Is local Supabase running? npm run dev:up" >&2
    exit 1
  fi
  maestro test "$flow" || failed+=("$flow")
done

if [ "${#failed[@]}" -gt 0 ]; then
  printf 'failed: %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "all ${#flows[@]} flows passed"
