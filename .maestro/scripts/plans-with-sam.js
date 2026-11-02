/* global http */
// sam becomes the dev user's Friend, and the dev user starts two Cook Plans with him, each with a
// Recipe of the dev user's and one of sam's (ticket 18), through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/plans-with-sam', { body: '' });
if (!res.ok) throw new Error(`plans-with-sam failed: ${res.status} ${res.body}`);
