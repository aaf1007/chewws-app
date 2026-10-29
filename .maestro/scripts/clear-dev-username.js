/* global http */
// Clears the dev user's username, so signing in asks for one, as for a new user, through
// scripts/net-control.mjs (scripts/e2e-db.mjs clear-dev-username).
const res = http.post('http://127.0.0.1:54491/clear-dev-username', { body: '' });
if (!res.ok) throw new Error(`clearing the username failed: ${res.status} ${res.body}`);
