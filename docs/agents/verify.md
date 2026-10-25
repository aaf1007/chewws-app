# Proving a ticket

A ticket is done when `npm run verify` and `npm run e2e` are both green and the new behaviour has a test or a flow.

## 1. Data layer

```sh
npm run verify   # typecheck, lint, database types freshness, vitest against local Supabase
```

## 2. On the simulator

```sh
npm run dev:up   # idempotent: local Supabase, Metro on 8081 (.logs/metro.log), iPhone 17 simulator, dev build
npm run e2e      # maestro test .maestro/: runs every top-level flow
```

- Write one flow per ticket in `.maestro/`, named after the ticket (`02-write-a-recipe-by-hand.yaml`). Start it with `- runFlow: subflows/sign-in-dev.yaml`, which relaunches the app with cleared state, loads the bundle from Metro and signs in as the seeded dev user, ending on the Library. `subflows/sign-out.yaml` signs out.
- Flows share the seeded dev user (`dev@example.com`) across flows and runs. Give records unique names (Maestro evaluates `${Date.now()}` inside strings) and assert only on what the flow created, or delete it at the end. `npm run db:reset` returns the dev user to an empty Library.
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
