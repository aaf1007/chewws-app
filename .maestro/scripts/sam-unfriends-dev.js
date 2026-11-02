/* global http */
// sam unfriends the dev user on his phone, through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-unfriends-dev', { body: '' });
if (!res.ok) throw new Error(`sam-unfriends-dev failed: ${res.status} ${res.body}`);
