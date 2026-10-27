// Makes the access token the app saved on the booted simulator expired, as after an hour in a
// pocket: the next request has to refresh it first. Run it while the app is stopped (AsyncStorage
// keeps what it read in memory and would write it back). The refresh token is left as it is.
//   node scripts/expire-session.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const bundleId = 'com.ant1007.recipeapp';
const container = execFileSync('xcrun', ['simctl', 'get_app_container', 'booted', bundleId, 'data'], {
  encoding: 'utf8',
}).trim();
const dir = join(container, 'Library', 'Application Support', bundleId, 'RCTAsyncLocalStorage_V1');
const manifestPath = join(dir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const key = Object.keys(manifest).find((k) => /^sb-.*-auth-token$/.test(k));
if (!key) {
  console.error('No saved session on the simulator. Sign in first.');
  process.exit(1);
}
// AsyncStorage keeps short values in the manifest and long ones in a file named by the key's md5.
const inline = manifest[key] !== null;
const valuePath = join(dir, createHash('md5').update(key).digest('hex'));
const session = JSON.parse(inline ? manifest[key] : readFileSync(valuePath, 'utf8'));
session.expires_at = Math.floor(Date.now() / 1000) - 60;
if (inline) {
  manifest[key] = JSON.stringify(session);
  writeFileSync(manifestPath, JSON.stringify(manifest));
} else {
  writeFileSync(valuePath, JSON.stringify(session));
}
console.log(`expired: ${key}`);
