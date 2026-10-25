# Proving a ticket

A ticket is done when `npm run verify` and `npm run e2e` are both green and the new behaviour has a test or a flow.

## 1. Data layer

```sh
npm run verify   # typecheck, lint, database types freshness, vitest against local Supabase
```

## 2. On the simulator

```sh
npm run dev:up   # idempotent: local Supabase, Metro on 8081 (.logs/metro.log), iPhone 17 simulator, dev build
npm run e2e      # scripts/e2e.sh: resets the local database, then runs one top-level flow; repeats per flow
npm run e2e -- .maestro/dev-ui-gallery.yaml   # just these flows (still reset first)
```

- Write one flow per ticket in `.maestro/`, named after the ticket (`02-write-a-recipe-by-hand.yaml`). Start it with `- runFlow: subflows/sign-in-dev.yaml`, which relaunches the app with cleared state, loads the bundle from Metro and signs in as the seeded dev user, ending on the Library. `subflows/sign-out.yaml` signs out from the Profile tab.
- Every flow starts from a freshly reset local database (`supabase db reset`: migrations plus `supabase/seed.sql`), so the seeded dev user (`dev@example.com`) has an empty Library and no other data. A flow may assume exactly that state and must not rely on anything another flow created. Data a flow needs, it creates itself. `npm run e2e` wipes the local database, so don't run it while you need data in it.
- Don't call `maestro test` on the whole folder for a ticket's proof: it skips the resets. Use `npm run e2e`.
- `subflows/launch-fresh.yaml` opens the dev build with `__expo_disable_onboarding=1&__expo_disable_auto_launch=1&__expo_disable_fab=1`, so no dev-client onboarding, menu or floating tools button covers the app during a flow. Don't drag dev chrome out of the way or retry taps; if a tap is swallowed, find what's covering the target.
- Tap tabs by test id: `tapOn: { id: "tab-library" }` (also `tab-pantry`, `tab-shopping-list`, `tab-profile`). Their accessibility labels read "Pantry, tab, 2 of 4".
- Files in `.maestro/subflows/` are not run on their own.
- Screenshot for the ticket notes: `xcrun simctl io booted screenshot /path/to/shot.png`. Inspect the screen with `maestro hierarchy`.
- On failure, Maestro's logs and screenshots are in `~/.maestro/tests/<timestamp>/`, and Metro's in `.logs/metro.log` (only when `dev:up` started Metro).

## The dev build

The app runs in an EAS development build (bundle id `com.ant1007.recipeapp`), which holds the native code; Metro serves the JavaScript. `dev:up` installs it when it's missing on the simulator, from `DEV_BUILD_APP=/path/to/recipeapp.app` if set, otherwise with `npx eas-cli build:run --platform ios --profile development --latest` (downloads the latest cloud build; needs `eas login`). The installed copy lives at `xcrun simctl get_app_container booted com.ant1007.recipeapp`.

Adding or upgrading a native module (anything with iOS code, or a config plugin) needs a new development build:

```sh
npx eas-cli build --profile development --platform ios --non-interactive
xcrun simctl uninstall booted com.ant1007.recipeapp
npm run dev:up   # installs the new build
```

That takes a cloud build, so prefer JS-only libraries. Check with `npx expo install <pkg>` and the package's docs whether it has native code.
