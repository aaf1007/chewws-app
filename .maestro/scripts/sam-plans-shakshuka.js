/* global http */
// sam puts butter in his Pantry and adds his shakshuka to the dev user's newest Cook Plan, with its
// lines for the plan's list, as his phone would, through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-plans-shakshuka', { body: '' });
if (!res.ok) throw new Error(`sam-plans-shakshuka failed: ${res.status} ${res.body}`);
