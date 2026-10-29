/* global http */
// alex_cooks and the dev user become Friends (ticket 13), as each of them, through scripts/net-control.mjs.
const res = http.post('http://127.0.0.1:54491/befriend-alex', { body: '' });
if (!res.ok) throw new Error(`befriend-alex failed: ${res.status} ${res.body}`);
