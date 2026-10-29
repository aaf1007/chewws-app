/* global http */
// The seeded user sam asks the dev user to be Friends, and the "Friend request" notification
// arrives, as the notify function would send it (xcrun simctl push with
// .maestro/assets/friend-request.apns), through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/friend-request-from-sam', { body: '' });
if (!res.ok) throw new Error(`sam's request failed: ${res.status} ${res.body}`);
