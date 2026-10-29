/* global http */
// Fails unless sam's list on the server has the dev user's changes, through scripts/net-control.mjs.
const res = http.post('http://127.0.0.1:54491/check-sams-list', { body: '' });
if (!res.ok) throw new Error(`check-sams-list failed: ${res.status} ${res.body}`);
