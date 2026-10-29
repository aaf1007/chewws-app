/* global http */
// Puts the caption screenshot (.maestro/assets/caption-screenshot.jpg) in the simulator's photo
// library, through scripts/net-control.mjs (started by scripts/e2e.sh), so a flow can pick it.
const res = http.post('http://127.0.0.1:54491/add-photo', { body: '' });
if (!res.ok) throw new Error(`adding the photo failed: ${res.status} ${res.body}`);
