/* global http */
// The dev user has five Recipes Tagged Weeknight, Garlic bread Italian too, and Leftovers on none
// (ticket 22), through scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/dev-tagged-recipes', { body: '' });
if (!res.ok) throw new Error(`dev-tagged-recipes failed: ${res.status} ${res.body}`);
