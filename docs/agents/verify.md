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

- `npm run dev:up` runs `scripts/functions.sh` and `npm run e2e` runs `scripts/functions.sh e2e`: `supabase functions serve` in the background (logs in `.logs/functions.log`). It picks up edited and new functions without a restart, and does nothing while `supabase/functions` holds no function. A serve running in the other mode is restarted in the one asked for, so after `npm run e2e` the functions stay on canned answers until `npm run dev:up` (or `scripts/functions.sh`) switches them back.
- Secrets come from `supabase/.env` (git-ignored; see `supabase/.env.example`), the file the CLI already reads for `config.toml`. After changing one, stop the serve process (`pkill -f '^([^ ]*/)?supabase functions serve'`) and rerun `scripts/functions.sh`. Keys starting with `SUPABASE_` are skipped; the runtime sets `SUPABASE_URL` and the keys itself. Never put a real key in a committed file.
- **Canned sources and Claude answers for the flows.** `scripts/functions.sh e2e` serves with `supabase/.env.e2e` (committed, no secrets) instead of `supabase/.env`. It sets `DRAFT_FIXTURES=1`, so `build-draft` and `refresh-source-video` read the canned videos, pages and Claude answers in `supabase/functions/_shared/draft-fixtures.ts` (the same ones the tests use; canned pages go through the real HTML readers) and make no request to TikTok, YouTube, any website or Anthropic. Nothing else sets it: it's not an `EXPO_PUBLIC_` value, so the app can't, and the functions refuse to run with it unless `SUPABASE_URL` is the local stack (`kong`, `localhost`, `127.0.0.1`), so a hosted project can't either. A flow saves one of these links; any other fails as unavailable:
  - TikTok: `https://www.tiktok.com/@pastaqueen/video/7400000000000000001` (a full recipe), `…@snackdad/video/7400000000000000002` ("link in bio"), `…@glitch/video/7400000000000000003` (can't be read), `…@brunchclub/video/7400000000000000004` (its caption links to the recipe site below).
  - YouTube: `https://www.youtube.com/shorts/LemonPasta1` (a full recipe in the description), `https://youtu.be/OldThumbnl1` (its stored thumbnail points at a `.invalid` host and never loads; `refresh-source-video` answers with a new one, as the platforms do "later").
  - Pages: `https://cooking.example.com/recipes/shakshuka` (a schema.org Recipe), `https://blog.example.org/my-kitchen-tour` (a plain page: title and picture).
- **Real builds** (`scripts/functions.sh`, as `dev:up` runs it) call TikTok oEmbed, the YouTube Data API, the shared page and Claude, every link read through the guarded fetch (`_shared/safe-fetch.ts`: https only, public hosts only, re-checked at each redirect, 8 s, 2 MB). With no `ANTHROPIC_API_KEY` in `supabase/.env` (or a key Anthropic refuses), a build fails as "not set up" rather than calling Claude without one; with no `YOUTUBE_API_KEY`, so does a YouTube build. Plain pages need neither. On the hosted project the keys are set with `supabase secrets set ANTHROPIC_API_KEY=… YOUTUBE_API_KEY=…`.
- **The rule: `npm run verify` never needs the functions runtime.** CI starts Supabase with `-x edge-runtime`, and tests never call `/functions/v1`. A function is a thin wrapper (`supabase/functions/<name>/index.ts`): it reads the request, calls runtime-neutral modules in `supabase/functions/_shared/` (the source reader, the Claude extractor, the Draft builder), and writes the result. Those modules take the Claude call and the source reader's adapters as parameters, so vitest runs them in Node with fakes (`CODING_STANDARDS.md`, Tests); the data layer's `startDraftBuild` option runs `buildDraft` in-process in tests (`tests/access-harness.ts`). They must also run in Deno: import siblings with their `.ts` extension (Deno won't resolve `./x`; `tsconfig.json` allows `./x.ts`), import npm packages by bare name only for types or through the function's `deno.json` import map, and use no Node-only or React Native imports. They may import pure modules under `src/` by relative path (`../../../src/data/ingredient-matcher.ts`; the CLI mounts imported files). `tsconfig.json` and eslint leave out only `supabase/functions/*/index.ts` (Deno globals), so `verify` typechecks and lints `_shared` but not the wrappers; keep them thin. If a function fails to load, `scripts/functions.sh` prints the end of `.logs/functions.log`. The real Claude call and the wrapper are checked by hand or in a Maestro flow, not in `verify`.
- **Sharing into the app.** The iOS share sheet (expo-share-intent's share extension) opens the app at `recipeapp://dataUrl=…`; `src/app/+native-intent.tsx` sends that to the Library and the root layout opens the save screen with what was shared. Maestro can't drive the share sheet, so flows open the same screen with `recipeapp://save?url=…` (URL-encoded), which covers everything after the share. Check the share itself by hand after a native change: `xcrun simctl openurl booted <a TikTok link>`, then in Safari ⋯ > Share > recipeapp > Save.

## The dev build

The app runs in an EAS development build (bundle id `com.ant1007.recipeapp`), which holds the native code; Metro serves the JavaScript. `dev:up` installs it when it's missing on the simulator, from `DEV_BUILD_APP=/path/to/recipeapp.app` if set, otherwise with `npx eas-cli build:run --platform ios --profile development --latest` (downloads the latest cloud build; needs `eas login`). The installed copy lives at `xcrun simctl get_app_container booted com.ant1007.recipeapp`.

Adding or upgrading a native module (anything with iOS code, or a config plugin) needs a new development build:

```sh
npx eas-cli build --profile development --platform ios --non-interactive
xcrun simctl uninstall booted com.ant1007.recipeapp
npm run dev:up   # installs the new build
```

That takes a cloud build, so prefer JS-only libraries. Check with `npx expo install <pkg>` and the package's docs whether it has native code.
