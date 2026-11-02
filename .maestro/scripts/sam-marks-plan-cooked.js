/* global http */
// sam taps "We cooked it" on the dev user's newest active Cook Plan with him, as his phone would,
// through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-marks-plan-cooked', { body: '' });
if (!res.ok) throw new Error(`sam-marks-plan-cooked failed: ${res.status} ${res.body}`);
