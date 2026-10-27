#!/usr/bin/env bash
# Serves this worktree's Edge Functions (supabase/functions/<name>/index.ts) on local Supabase at
# http://127.0.0.1:<api port>/functions/v1/<name>, for the app on the simulator and for the e2e flows.
# `supabase functions serve` replaces the runtime `supabase start` ran, picks up edited and new
# functions without a restart, and gets its secrets from supabase/.env (git-ignored) when it exists.
# Restart it after changing a secret: kill the serve process, then rerun this.
# Safe to rerun: a serve this worktree already runs is left alone. Logs in .logs/functions.log.
#
#   scripts/functions.sh       secrets from supabase/.env: real TikTok and Claude (dev:up)
#   scripts/functions.sh e2e   settings from supabase/.env.e2e: canned sources and Claude answers
#                              (DRAFT_FIXTURES=1), so the flows make no network calls (npm run e2e)
# A serve running in the other mode is restarted in the one asked for.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-dev}"
case "$mode" in
  dev) env_file="supabase/.env" ;;
  e2e) env_file="supabase/.env.e2e" ;;
  *) echo "usage: scripts/functions.sh [e2e]" >&2; exit 2 ;;
esac

project_id="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n 1)"
runtime="supabase_edge_runtime_${project_id}"
here="$(pwd -P)"

if ! compgen -G 'supabase/functions/*/index.ts' >/dev/null; then
  # `supabase functions serve` fails with nothing to serve.
  echo "functions: none in supabase/functions"
  exit 0
fi

ours=""
for pid in $(pgrep -f '^([^ ]*/)?supabase functions serve' || true); do
  cwd="$(lsof -a -nP -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
  if [ "$cwd" = "$here" ]; then
    ours="$pid"
  else
    # The stack (and its one functions runtime) is shared by every worktree with this project_id.
    # Starting another serve would take the runtime away from that one.
    echo "functions: pid $pid already serves functions from ${cwd:-another directory} on this stack." >&2
    echo "Stop it there first (kill $pid), then rerun." >&2
    exit 1
  fi
done

serving_e2e() { ps -o command= -p "$1" 2>/dev/null | grep -q -- '--env-file supabase/.env.e2e'; }
restart_reason=""
if [ -n "$ours" ] && [ "$(docker inspect -f '{{.State.Status}}' "$runtime" 2>/dev/null || true)" != running ]; then
  # Left over from a stack that was stopped under it.
  restart_reason="pid $ours has no runtime"
elif [ -n "$ours" ]; then
  running_mode=dev
  serving_e2e "$ours" && running_mode=e2e
  if [ "$running_mode" != "$mode" ]; then restart_reason="switching from $running_mode to $mode settings"; fi
fi
if [ -n "$restart_reason" ]; then
  echo "functions: restarting ($restart_reason)"
  kill "$ours"
  for _ in $(seq 50); do kill -0 "$ours" 2>/dev/null || break; sleep 0.1; done
  ours=""
fi

if [ -n "$ours" ]; then
  echo "functions: serving (pid $ours, $mode)"
else
  echo "functions: starting with $mode settings (logs in .logs/functions.log)"
  env_args=()
  [ -f "$env_file" ] && env_args=(--env-file "$env_file")
  mkdir -p .logs
  nohup supabase functions serve ${env_args[@]+"${env_args[@]}"} >.logs/functions.log 2>&1 &
  ours=$!
fi

if ! scripts/stack-ready.sh; then
  # A function that doesn't load (a bad import, say) ends the serve at once; its log says why.
  kill -0 "$ours" 2>/dev/null || { echo "supabase functions serve exited:" >&2; tail -n 5 .logs/functions.log >&2; }
  exit 1
fi
