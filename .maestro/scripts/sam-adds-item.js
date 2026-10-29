/* global http */
// sam adds Dish soap to their shared list, as sam's phone would, through scripts/net-control.mjs.
const res = http.post('http://127.0.0.1:54491/sam-adds-item', { body: '' });
if (!res.ok) throw new Error(`sam-adds-item failed: ${res.status} ${res.body}`);
