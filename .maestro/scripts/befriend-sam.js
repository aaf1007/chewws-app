/* global http */
// sam and the dev user become Friends, so the dev user can invite sam into a Cook Plan, through
// scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/befriend-sam', { body: '' });
if (!res.ok) throw new Error(`befriend-sam failed: ${res.status} ${res.body}`);
