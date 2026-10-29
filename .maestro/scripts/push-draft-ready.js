/* global http */
// Delivers a "Draft ready" notification for the dev user's newest Draft to the app, as Expo's push
// service would (xcrun simctl push with .maestro/assets/draft-ready.apns), through
// scripts/net-control.mjs (started by scripts/e2e.sh). No Expo push token or network is involved.
const res = http.post('http://127.0.0.1:54491/push-draft-ready', { body: '' });
if (!res.ok) throw new Error(`sending the push failed: ${res.status} ${res.body}`);
