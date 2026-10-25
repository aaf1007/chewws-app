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

# Flows that take the app offline (.maestro/scripts/go-offline.js) ask this to pause the local API
# gateway. Whatever happens, the gateway is running again when this script ends.
node scripts/net-control.mjs &
net_control=$!
trap 'kill "$net_control" 2>/dev/null || true; scripts/net.sh online >/dev/null' EXIT

failed=()
for flow in "${flows[@]}"; do
  scripts/net.sh online >/dev/null
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
