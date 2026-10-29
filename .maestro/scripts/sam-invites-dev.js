/* global http */
// sam starts a Cook Plan and invites the dev user, and the "Cook Plan invite" notification arrives,
// as the notify function would send it (xcrun simctl push with .maestro/assets/cook-plan-invite.apns),
// through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/sam-invites-dev', { body: '' });
if (!res.ok) throw new Error(`sam-invites-dev failed: ${res.status} ${res.body}`);
