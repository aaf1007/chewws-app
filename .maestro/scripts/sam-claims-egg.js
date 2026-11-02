/* global http */
// sam Claims the egg on the dev user's Cook Plan list, as his phone would, through
// scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-claims-egg', { body: '' });
if (!res.ok) throw new Error(`sam-claims-egg failed: ${res.status} ${res.body}`);
