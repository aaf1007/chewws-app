/* global http */
// The dev user has four Cooked Recipes, Shakshuka and Dal ranked in Liked (ticket 17), through
// scripts/net-control.mjs. No network.
const res = http.post('http://127.0.0.1:54491/dev-cooked-recipes', { body: '' });
if (!res.ok) throw new Error(`dev-cooked-recipes failed: ${res.status} ${res.body}`);
