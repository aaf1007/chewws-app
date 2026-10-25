#!/usr/bin/env bash
# Brings up everything the app needs on the simulator. Safe to rerun: each step skips what's already up.
set -euo pipefail
cd "$(dirname "$0")/.."

SIM_UDID="${SIM_UDID:-E3E9E27B-8256-4587-BDE4-C77451E23541}" # iPhone 17
BUNDLE_ID="com.ant1007.recipeapp"
METRO_PORT="${METRO_PORT:-8081}"

if supabase status >/dev/null 2>&1; then
  echo "supabase: running"
else
  echo "supabase: starting"
  supabase start
fi

if curl -fsS "http://127.0.0.1:$METRO_PORT/status" 2>/dev/null | grep -q 'packager-status:running'; then
  echo "metro: running on $METRO_PORT"
else
  echo "metro: starting on $METRO_PORT (logs in .logs/metro.log)"
  mkdir -p .logs
  nohup npx expo start --dev-client --port "$METRO_PORT" >.logs/metro.log 2>&1 &
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$METRO_PORT/status" 2>/dev/null | grep -q 'packager-status:running' && break
    sleep 1
  done
  curl -fsS "http://127.0.0.1:$METRO_PORT/status" 2>/dev/null | grep -q 'packager-status:running' \
    || { echo "metro did not start; see .logs/metro.log" >&2; exit 1; }
fi

if xcrun simctl list devices booted | grep -q "$SIM_UDID"; then
  echo "simulator: booted"
else
  echo "simulator: booting $SIM_UDID"
  xcrun simctl boot "$SIM_UDID"
  xcrun simctl bootstatus "$SIM_UDID" >/dev/null
fi

if xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE_ID" >/dev/null 2>&1; then
  echo "dev build: installed"
elif [ -n "${DEV_BUILD_APP:-}" ]; then
  echo "dev build: installing $DEV_BUILD_APP"
  xcrun simctl install "$SIM_UDID" "$DEV_BUILD_APP"
else
  echo "dev build: installing the latest EAS development build"
  npx --yes eas-cli build:run --platform ios --profile development --latest --simulator "$SIM_UDID"
fi

echo "ready: npm run e2e"
