import { execFileSync } from 'node:child_process';

import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: { url: string; anonKey: string; serviceRoleKey: string };
  }
}

// Vitest 5 crashes while source-mapping errors thrown from globalSetup, hiding the message, so print and exit.
function stop(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function readStatus(): Map<string, string> {
  let output: string;
  try {
    output = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    stop('Local Supabase is not running. Start it with `npm run db:start`, then rerun the tests.');
  }
  const vars = new Map<string, string>();
  for (const line of output.split('\n')) {
    const match = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
    if (match) vars.set(match[1], match[2]);
  }
  return vars;
}

export default function setup(project: TestProject) {
  const status = readStatus();
  const need = (key: string) => {
    const value = status.get(key);
    if (!value) stop(`\`supabase status -o env\` did not report ${key}. Is the local stack healthy?`);
    return value;
  };
  project.provide('supabase', {
    url: need('API_URL'),
    anonKey: need('ANON_KEY'),
    serviceRoleKey: need('SERVICE_ROLE_KEY'),
  });
}
