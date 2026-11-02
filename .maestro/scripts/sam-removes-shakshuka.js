/* global http */
// sam takes his shakshuka out of the dev user's Cook Plan, as his phone would, through
// scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-removes-shakshuka', { body: '' });
if (!res.ok) throw new Error(`sam-removes-shakshuka failed: ${res.status} ${res.body}`);
