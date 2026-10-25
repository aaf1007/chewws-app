#!/usr/bin/env bash
# Takes the app offline, or back online, against local Supabase: pauses or unpauses this project's
# API gateway container, so every request from the simulator gets no answer, as with no signal.
# Only this project's gateway (named from supabase/config.toml); other projects' stacks are never
# touched.
#   scripts/net.sh offline | online | status
set -euo pipefail
cd "$(dirname "$0")/.."

project_id="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n 1)"
[ -n "$project_id" ] || { echo "no project_id in supabase/config.toml" >&2; exit 1; }
container="supabase_kong_${project_id}"
state="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null)" \
  || { echo "$container is not running. npm run dev:up" >&2; exit 1; }

case "${1:-}" in
  offline)
    [ "$state" = paused ] || docker pause "$container" >/dev/null
    echo "offline: $container paused"
    ;;
  online)
    [ "$state" != paused ] || docker unpause "$container" >/dev/null
    echo "online: $container running"
    ;;
  status)
    echo "$container: $state"
    ;;
  *)
    echo "usage: scripts/net.sh offline|online|status" >&2
    exit 2
    ;;
esac
