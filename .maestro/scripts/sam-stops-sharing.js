/* global http */
// sam stops sharing their list with the dev user, through scripts/net-control.mjs.
const res = http.post('http://127.0.0.1:54491/sam-stops-sharing', { body: '' });
if (!res.ok) throw new Error(`sam-stops-sharing failed: ${res.status} ${res.body}`);
