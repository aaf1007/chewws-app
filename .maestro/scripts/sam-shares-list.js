/* global http */
// sam and the dev user become Friends, and sam shares their Shopping List (Oat milk, Coffee beans)
// with the dev user, through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-shares-list', { body: '' });
if (!res.ok) throw new Error(`sam-shares-list failed: ${res.status} ${res.body}`);
