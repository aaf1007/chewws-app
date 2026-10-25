/* global http */
// Brings the app back online: asks scripts/net-control.mjs to unpause the local API gateway.
const res = http.post('http://127.0.0.1:54491/online', { body: '' });
if (!res.ok) throw new Error(`going online failed: ${res.status} ${res.body}`);
