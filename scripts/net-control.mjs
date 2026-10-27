// Lets a Maestro flow take the app offline and back: Maestro's runScript can make HTTP requests
// but not run commands, so scripts/e2e.sh runs this while flows run. POST /offline or /online runs
// scripts/net.sh with that word; POST /expire-session runs scripts/expire-session.mjs (the app's
// saved access token runs out); nothing else. Listens on 127.0.0.1 only.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.NET_CONTROL_PORT ?? 54491);
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const commands = {
  '/offline': [script('./net.sh'), ['offline']],
  '/online': [script('./net.sh'), ['online']],
  '/expire-session': [process.execPath, [script('./expire-session.mjs')]],
};

createServer((req, res) => {
  const command = commands[req.url ?? ''];
  if (req.method !== 'POST' || !command) {
    res.writeHead(404).end();
    return;
  }
  execFile(...command, (error, stdout, stderr) => {
    res.writeHead(error ? 500 : 200, { 'content-type': 'text/plain' }).end(error ? stderr || String(error) : stdout);
  });
})
  .on('error', (error) => {
    const why = error.code === 'EADDRINUSE' ? `port ${port} is taken by another process` : String(error);
    console.error(`net-control.mjs can't listen: ${why}.`);
    process.exit(1);
  })
  .listen(port, '127.0.0.1');
