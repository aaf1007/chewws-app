# Recipe App

Expo (React Native, TypeScript) app for iPhone, backed by Supabase. Product spec and tickets live in `.scratch/recipe-app-v1/`, domain terms in `GLOSSARY.md`, decisions in `docs/adr/`.

## Layout

- `src/app/`: expo-router screens. The root layout shows the sign-in screen or the library screen depending on the session.
- `src/data/`: the data layer, and the only code allowed to import `@supabase/*` (ESLint enforces this). `createDataLayer(client)` returns typed actions; `src/data/app.ts` builds the app's client.
- `src/auth/`: native Apple and Google sign-in, which hand their ID tokens to the data layer.
- `supabase/`: local Supabase config, migrations and `seed.sql`.
- `tests/`: vitest tests that drive the data layer as real signed-in users against local Supabase.

## Prerequisites

Node 24, Docker Desktop, the Supabase CLI, and Xcode with an iOS simulator. Then:

```sh
npm install
cp .env.example .env.local
```

`.env.example` already holds the local Supabase URL and the CLI's shared local anon key.

## Local Supabase

```sh
npm run db:start   # start the stack and apply migrations (first run pulls Docker images)
npm run db:reset   # wipe the database, reapply migrations, then run supabase/seed.sql
npm run db:stop
npm run db:types   # regenerate src/data/database.types.ts after changing a migration
```

The ports are the CLI defaults plus 100 (API on `http://127.0.0.1:54421`, Studio on `http://127.0.0.1:54423`) so this stack can run next to another local Supabase project. `supabase status` prints the URLs and keys.

The seed creates a dev user, `dev@example.com` / `password123`.

## Tests

```sh
npm run db:start
npm test
```

The tests read the API URL and keys from `supabase status`, so they fail straight away with a message if the stack is down. Each call to `signInTestUser()` in `tests/harness.ts` creates a fresh user and returns that user's data layer. Tests call only data-layer actions.

`npm run typecheck` and `npm run lint` cover the rest.

## Running the app

The app runs as a development build, not in Expo Go, because it uses native modules (Apple and Google sign-in, and later a share extension).

### Local build

```sh
npm run db:start
npm run ios
```

This prebuilds `ios/` (generated, not committed), builds, installs on a booted simulator and starts Metro. In a dev build against the local stack, the sign-in screen has a **Sign in as test user (dev)** button that signs in as the seeded user, so the signed-in flow works without Apple or Google credentials.

The Sign in with Apple entitlement means Xcode has to sign even simulator builds. If `npm run ios` stops with "No code signing certificates are available to use", sign in to Xcode with your Apple ID (Xcode > Settings > Accounts) so a development team and certificate exist, then run it again. If you have no Apple ID set up yet, use the EAS build below.

### EAS development build (simulator)

```sh
npx eas-cli build --profile development --platform ios
```

The `development` profile in `eas.json` builds a simulator `.app` with the dev client and needs no Apple credentials. When it finishes, install and run it:

```sh
npx eas-cli build:run --platform ios --latest   # or: xcrun simctl install booted <path to .app>
npx expo start --dev-client
```

The dev client then loads the JavaScript from Metro on your machine, and Metro reads `.env.local`.

### UI check

`.maestro/dev-sign-in-and-out.yaml` taps through sign-in with the dev button, the empty library and sign-out. You need Maestro (`brew install mobile-dev-inc/tap/maestro`), a running app and Metro:

```sh
maestro test .maestro/dev-sign-in-and-out.yaml
```

## Making Apple and Google sign-in real

Both providers use native ID-token sign-in: the iOS SDK returns an ID token and the app passes it to `supabase.auth.signInWithIdToken`. The code and config are in place. Only these credentials are missing, and each needs a person with access to the accounts.

### Sign in with Apple

1. In the Apple Developer portal (paid program), open Certificates, Identifiers & Profiles > Identifiers, register or select the App ID `com.ant1007.recipeapp` and enable **Sign in with Apple**.
2. Build with that team: sign in to Xcode for local builds, or let EAS manage credentials for device builds (`npx eas-cli credentials`).
3. Supabase needs no secret for native sign-in. `[auth.external.apple]` in `supabase/config.toml` already lists the bundle id as the client id. On the hosted project, enable the Apple provider and add `com.ant1007.recipeapp` under Client IDs.
4. On a simulator, sign in to an Apple ID in the simulator's Settings app before tapping the button.

### Sign in with Google

1. In Google Cloud Console > APIs & Services > Credentials, set up the OAuth consent screen, then create two OAuth client IDs:
   - **iOS**, bundle id `com.ant1007.recipeapp`
   - **Web application**, whose client ID and secret Supabase uses to check tokens
2. App env, in `.env.local` locally or as EAS environment variables for cloud builds:
   - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`: the iOS client ID (`…apps.googleusercontent.com`). `app.config.ts` turns it into the URL scheme the Google plugin needs, so rebuild the native app after setting it.
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`: the web client ID.
3. Local Supabase: copy `supabase/.env.example` to `supabase/.env` and set
   - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<web client id>,<ios client id>`
   - `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<web client secret>`

   Then restart with `npm run db:stop && npm run db:start`. For the hosted project, enable Google in the dashboard, enter the web client ID and secret, add the iOS client ID to the authorized client IDs, and turn on "Skip nonce check". The iOS Google SDK adds a nonce the app can't read, which is also why `skip_nonce_check = true` is set locally.

Until these are set, the Google button shows a "not configured" message instead of starting sign-in.
