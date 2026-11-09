/* global http */
// sam is the dev user's Friend, with Shakshuka, Dal and Toast logged and two of them ranked (ticket
// 19), through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-cooked-and-ranked', { body: '' });
if (!res.ok) throw new Error(`sam-cooked-and-ranked failed: ${res.status} ${res.body}`);
