/* global http */
// Gives the dev user link saves up to the daily limit of 30 (from an hour ago), through
// scripts/net-control.mjs, so the flow's next save is the 31st in 24 hours.
const res = http.post('http://127.0.0.1:54491/fill-daily-limit', { body: '' });
if (!res.ok) throw new Error(`filling the daily limit failed: ${res.status} ${res.body}`);
