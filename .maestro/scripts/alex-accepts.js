/* global http */
// The seeded user alex_cooks accepts the dev user's friend request, as if on their own phone,
// through scripts/net-control.mjs (scripts/e2e-db.mjs alex-accepts).
const res = http.post('http://127.0.0.1:54491/alex-accepts', { body: '' });
if (!res.ok) throw new Error(`alex's answer failed: ${res.status} ${res.body}`);
