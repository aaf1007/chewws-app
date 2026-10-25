// Lets a Maestro flow take the app offline and back: Maestro's runScript can make HTTP requests
// but not run commands, so scripts/e2e.sh runs this while flows run. POST /offline or /online runs
// scripts/net.sh with that word, and nothing else. Listens on 127.0.0.1 only.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.NET_CONTROL_PORT ?? 54491);
const netScript = fileURLToPath(new URL('./net.sh', import.meta.url));
const states = { '/offline': 'offline', '/online': 'online' };

createServer((req, res) => {
  const state = states[req.url ?? ''];
  if (req.method !== 'POST' || !state) {
    res.writeHead(404).end();
    return;
  }
  execFile(netScript, [state], (error, stdout, stderr) => {
    res.writeHead(error ? 500 : 200, { 'content-type': 'text/plain' }).end(error ? stderr || String(error) : stdout);
  });
}).listen(port, '127.0.0.1');
