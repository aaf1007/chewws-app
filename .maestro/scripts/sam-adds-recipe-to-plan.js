/* global http */
// sam adds his own Recipe (Sam's shakshuka) to the dev user's newest Cook Plan, as his phone would,
// through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-adds-recipe-to-plan', { body: '' });
if (!res.ok) throw new Error(`sam-adds-recipe-to-plan failed: ${res.status} ${res.body}`);
