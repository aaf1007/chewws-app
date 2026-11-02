// Lets a Maestro flow take the app offline and back: Maestro's runScript can make HTTP requests
// but not run commands, so scripts/e2e.sh runs this while flows run. POST /offline or /online runs
// scripts/net.sh with that word; POST /expire-session runs scripts/expire-session.mjs (the app's
// saved access token runs out); POST /add-photo puts .maestro/assets/caption-screenshot.jpg in the
// booted simulator's photo library (for a flow that picks a screenshot); POST /push-draft-ready and
// /fill-daily-limit run scripts/e2e-db.mjs with that word (a "Draft ready" push for the dev user's
// newest Draft; the dev user at the daily limit), and so do /clear-dev-username,
// /friend-request-from-sam and /alex-accepts (ticket 11: the dev user with no username yet; the
// seeded sam asking the dev user to be Friends, with the push; the seeded alex_cooks accepting the
// dev user's request), and /befriend-alex, /sam-shares-list, /sam-adds-item, /check-sams-list and
// /sam-stops-sharing (ticket 13: alex_cooks a Friend to share with; sam sharing their list with the
// dev user, adding to it, checking it has the dev user's changes, and stopping); nothing else. Listens on 127.0.0.1 only.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.NET_CONTROL_PORT ?? 54491);
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const commands = {
  '/offline': [script('./net.sh'), ['offline']],
  '/online': [script('./net.sh'), ['online']],
  '/expire-session': [process.execPath, [script('./expire-session.mjs')]],
  '/add-photo': ['xcrun', ['simctl', 'addmedia', 'booted', script('../.maestro/assets/caption-screenshot.jpg')]],
  '/push-draft-ready': [process.execPath, [script('./e2e-db.mjs'), 'push-draft-ready']],
  '/fill-daily-limit': [process.execPath, [script('./e2e-db.mjs'), 'fill-daily-limit']],
  '/clear-dev-username': [process.execPath, [script('./e2e-db.mjs'), 'clear-dev-username']],
  '/friend-request-from-sam': [process.execPath, [script('./e2e-db.mjs'), 'friend-request-from-sam']],
  '/alex-accepts': [process.execPath, [script('./e2e-db.mjs'), 'alex-accepts']],
  '/befriend-alex': [process.execPath, [script('./e2e-db.mjs'), 'befriend-alex']],
  '/sam-shares-list': [process.execPath, [script('./e2e-db.mjs'), 'sam-shares-list']],
  '/sam-adds-item': [process.execPath, [script('./e2e-db.mjs'), 'sam-adds-item']],
  '/check-sams-list': [process.execPath, [script('./e2e-db.mjs'), 'check-sams-list']],
  '/sam-stops-sharing': [process.execPath, [script('./e2e-db.mjs'), 'sam-stops-sharing']],
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
