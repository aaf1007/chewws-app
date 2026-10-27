/* global http */
// Takes the app offline: asks scripts/net-control.mjs (started by scripts/e2e.sh) to pause the
// local API gateway.
const res = http.post('http://127.0.0.1:54491/offline', { body: '' });
if (!res.ok) throw new Error(`going offline failed: ${res.status} ${res.body}`);
