#!/usr/bin/env bash
# Waits until the app can reach local Supabase through Kong, the API gateway it talks to: auth
# answers its health check, Storage its status (the screenshots users add, ticket 05), and the Edge
# Functions runtime answers when there are functions (scripts/functions.sh serves them).
#
# `supabase db reset` restarts auth, storage, realtime and the functions runtime, and they can come
# back at each other's addresses. Kong keeps the old one, so sign-in gets "An invalid response was
# received from the upstream server" (502) for as long as Kong runs, not just for a moment. So
# whenever an answer is a 502 this reloads Kong, whose fresh workers look the addresses up again.
# Bounded (60 s: Storage can take 40 s to come back on a busy Docker): a broken stack fails here
# and says what didn't answer.
set -euo pipefail
cd "$(dirname "$0")/.."

project_id="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n 1)"
api_port="$(awk '/^\[api\]/{a=1;next} /^\[/{a=0} a&&/^port *=/{print $3; exit}' supabase/config.toml)"
api="http://127.0.0.1:${api_port}"
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$1" || true; }

# Only once there are functions to serve: scripts/functions.sh serves nothing until then.
want_functions=""
compgen -G 'supabase/functions/*/index.ts' >/dev/null && want_functions=1

auth="" storage="" functions="" last_reload=0
wait_s=60
deadline=$((SECONDS + wait_s))
while [ "$SECONDS" -lt "$deadline" ]; do
  auth="$(status "$api/auth/v1/health")"
  storage="$(status "$api/storage/v1/status")"
  # No function name: the runtime itself answers 404 "Function not found"; Kong answers 5xx.
  functions=404
  [ -n "$want_functions" ] && functions="$(status "$api/functions/v1/")"
  [ "$auth" = 200 ] && [ "$storage" = 200 ] && [ "$functions" = 404 ] && exit 0
  if { [ "$auth" = 502 ] || [ "$storage" = 502 ] || [ "$functions" = 502 ]; } && [ $((SECONDS - last_reload)) -ge 3 ]; then
    docker exec "supabase_kong_${project_id}" kong reload >/dev/null 2>&1 || true
    last_reload=$SECONDS
  fi
  sleep 0.5
done

echo "Local Supabase isn't reachable through Kong after ${wait_s}s:" >&2
[ "$auth" = 200 ] || echo "  auth: $api/auth/v1/health gave HTTP $auth (docker logs supabase_auth_${project_id})" >&2
[ "$storage" = 200 ] || echo "  storage: $api/storage/v1/status gave HTTP $storage (docker logs supabase_storage_${project_id})" >&2
[ "$functions" = 404 ] || echo "  functions: $api/functions/v1/ gave HTTP $functions (scripts/functions.sh, .logs/functions.log)" >&2
echo "Bring it up with npm run dev:up, or restart it: npm run db:stop && npm run dev:up" >&2
exit 1
