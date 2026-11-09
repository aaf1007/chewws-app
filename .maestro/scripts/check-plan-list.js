/* global http */
// Fails unless the dev user's Cook Plan list on the server has their changes, and their Pantry the
// lines they checked off, through scripts/net-control.mjs.
const res = http.post('http://127.0.0.1:54491/check-plan-list', { body: '' });
if (!res.ok) throw new Error(`check-plan-list failed: ${res.status} ${res.body}`);
