# Proving a ticket

A ticket is done when `npm run verify` and `npm run e2e` are both green and the new behaviour has a test or a flow.

## 1. Data layer

```sh
npm run verify   # typecheck, lint, database types freshness, vitest against local Supabase
```

## 2. On the simulator

```sh
npm run dev:up   # idempotent: local Supabase, Edge Functions, Metro on 8081 (.logs/metro.log), iPhone 17 simulator, dev build
npm run e2e      # scripts/e2e.sh: resets the local database, waits until it answers, then runs one top-level flow; repeats per flow
npm run e2e -- .maestro/dev-ui-gallery.yaml   # just these flows (still reset first)
```

- Write one flow per ticket in `.maestro/`, named after the ticket (`02-write-a-recipe-by-hand.yaml`). Start it with `- runFlow: subflows/sign-in-dev.yaml`, which relaunches the app with cleared state, loads the bundle from Metro and signs in as the seeded dev user, ending on the Library. `subflows/sign-out.yaml` signs out from the Profile tab.
- Every flow starts from a freshly reset local database (`supabase db reset`: migrations plus `supabase/seed.sql`), so the seeded dev user (`dev@example.com`) has an empty Library and no other data. A flow may assume exactly that state and must not rely on anything another flow created. Data a flow needs, it creates itself. `npm run e2e` wipes the local database, so don't run it while you need data in it.
- After each reset, `scripts/stack-ready.sh` waits (30 s at most) until auth, and the functions runtime when there are functions, answer through Kong. The reset restarts those containers and they can swap addresses; Kong keeps the old ones and answers 502 ("An invalid response was received from the upstream server") until it is reloaded, which the script does. Don't add sleeps or retries to flows for this.
- Don't call `maestro test` on the whole folder for a ticket's proof: it skips the resets. Use `npm run e2e`.
- `subflows/launch-fresh.yaml` opens the dev build with `__expo_disable_onboarding=1&__expo_disable_auto_launch=1&__expo_disable_fab=1`, so no dev-client onboarding, menu or floating tools button covers the app during a flow. Don't drag dev chrome out of the way or retry taps; if a tap is swallowed, find what's covering the target.
- Tap tabs by test id: `tapOn: { id: "tab-library" }` (also `tab-pantry`, `tab-shopping-list`, `tab-profile`). Their accessibility labels read "Pantry, tab, 2 of 4".
- Files in `.maestro/subflows/` are not run on their own.
- Screenshot for the ticket notes: `xcrun simctl io booted screenshot /path/to/shot.png`. Inspect the screen with `maestro hierarchy`.
- On failure, Maestro's logs and screenshots are in `~/.maestro/tests/<timestamp>/`, and Metro's in `.logs/metro.log` (only when `dev:up` started Metro).

## Edge Functions

A function lives in `supabase/functions/<name>/index.ts` and is served at `http://127.0.0.1:54421/functions/v1/<name>` (the API URL the app and tests already use), with a user's access token or the anon key as `Authorization: Bearer …`.

- `npm run dev:up` and `npm run e2e` run `scripts/functions.sh`: `supabase functions serve` in the background (logs in `.logs/functions.log`). It picks up edited and new functions without a restart, and does nothing while `supabase/functions` holds no function.
- Secrets come from `supabase/.env` (git-ignored; see `supabase/.env.example`), the file the CLI already reads for `config.toml`. After changing one, stop the serve process (`pkill -f '^([^ ]*/)?supabase functions serve'`) and rerun `scripts/functions.sh`. Keys starting with `SUPABASE_` are skipped; the runtime sets `SUPABASE_URL` and the keys itself. Never put a real key in a committed file.
- Only one serve can run per stack, and every worktree with this `project_id` shares the stack. `scripts/functions.sh` stops with a message if another worktree's serve is running. Never start a second `supabase functions serve` by hand: it takes the runtime down before it fails.
- **The rule: `npm run verify` never needs the functions runtime.** CI starts Supabase with `-x edge-runtime`, and tests never call `/functions/v1`. A function is a thin wrapper: it reads the request, calls a module under `src/` (for the Draft builder, the logic that turns source reader output plus the Claude answer into a Draft), and writes the result. That module takes the Claude call and the source reader as parameters, so vitest runs it in Node with fakes (`CODING_STANDARDS.md`, Tests). The function imports it by relative path (`../../../src/…/x.ts`; the CLI mounts imported files), so the module must also run in Deno: import siblings with their `.ts` extension (Deno won't resolve `./x`; `tsconfig.json` allows `./x.ts`), and use no Node-only or React Native imports. `tsconfig.json` leaves out `supabase/functions` (Deno globals), so `verify` doesn't typecheck the wrappers; keep them thin. If a function fails to load, `scripts/functions.sh` prints the end of `.logs/functions.log`. The real Claude call and the wrapper are checked by hand or in a Maestro flow, not in `verify`.

## The dev build

The app runs in an EAS development build (bundle id `com.ant1007.recipeapp`), which holds the native code; Metro serves the JavaScript. `dev:up` installs it when it's missing on the simulator, from `DEV_BUILD_APP=/path/to/recipeapp.app` if set, otherwise with `npx eas-cli build:run --platform ios --profile development --latest` (downloads the latest cloud build; needs `eas login`). The installed copy lives at `xcrun simctl get_app_container booted com.ant1007.recipeapp`.

Adding or upgrading a native module (anything with iOS code, or a config plugin) needs a new development build:

```sh
npx eas-cli build --profile development --platform ios --non-interactive
xcrun simctl uninstall booted com.ant1007.recipeapp
npm run dev:up   # installs the new build
```

That takes a cloud build, so prefer JS-only libraries. Check with `npx expo install <pkg>` and the package's docs whether it has native code.
