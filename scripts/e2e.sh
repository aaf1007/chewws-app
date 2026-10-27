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
# The flows call it on this port; whatever else holds the port would answer them instead.
port="${NET_CONTROL_PORT:-54491}"
listening_on_port() { lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true; }
here="$(pwd -P)"
for pid in $(listening_on_port); do
  # One left from an earlier run in this worktree (cut short, so orphaned) is stopped; anything
  # else, another run's still live, is an error.
  command="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  cwd="$(lsof -a -nP -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
  parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [[ "$command" == *net-control.mjs* && "$cwd" == "$here" && "$parent" == 1 ]]; then
    echo "== stopping net-control.mjs left running from an earlier run (pid $pid)"
    kill "$pid"
    for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  else
    echo "Port $port, which the flows use to go offline and online, is taken by pid $pid: $command" >&2
    echo "Stop it (or end the other e2e run) and try again." >&2
    exit 1
  fi
done

node scripts/net-control.mjs &
net_control=$!
trap 'kill "$net_control" 2>/dev/null || true; scripts/net.sh online >/dev/null' EXIT
for _ in $(seq 50); do
  if ! kill -0 "$net_control" 2>/dev/null; then
    echo "scripts/net-control.mjs didn't start (see above), so flows can't go offline." >&2
    exit 1
  fi
  [[ " $(listening_on_port | tr '\n' ' ') " == *" $net_control "* ]] && break
  sleep 0.1
done
if [[ " $(listening_on_port | tr '\n' ' ') " != *" $net_control "* ]]; then
  echo "scripts/net-control.mjs isn't listening on port $port, so flows can't go offline." >&2
  exit 1
fi

# The flows reach Edge Functions too; serve this worktree's (no-op when already served).
scripts/functions.sh e2e

failed=()
for flow in "${flows[@]}"; do
  scripts/net.sh online >/dev/null
  echo "== $flow: resetting the local database"
  if ! out="$(supabase db reset 2>&1)"; then
    echo "$out" >&2
    echo "supabase db reset failed. Is local Supabase running? npm run dev:up" >&2
    exit 1
  fi
  # The reset restarts auth and the functions runtime, which Kong may still look for at their old
  # addresses; this waits until both answer through Kong (see scripts/stack-ready.sh).
  scripts/stack-ready.sh
  maestro test "$flow" || failed+=("$flow")
done

if [ "${#failed[@]}" -gt 0 ]; then
  printf 'failed: %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "all ${#flows[@]} flows passed"
