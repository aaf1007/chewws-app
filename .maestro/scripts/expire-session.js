/* global http */
// The app's saved access token runs out, as after an hour in a pocket: asks
// scripts/net-control.mjs (started by scripts/e2e.sh) to rewrite it. Run with the app stopped.
const res = http.post('http://127.0.0.1:54491/expire-session', { body: '' });
if (!res.ok) throw new Error(`expiring the session failed: ${res.status} ${res.body}`);
