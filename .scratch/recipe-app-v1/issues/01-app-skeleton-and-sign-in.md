# 01: App skeleton and sign-in

**What to build:** A user can open the app on the iOS simulator (an Expo development build, not Expo Go), sign in with Apple or Google, and land on an empty library screen. Behind it, a local Supabase stack runs with migrations, and the data layer exists as the only way screens talk to the backend. The test harness can sign in several test users against local Supabase and call data-layer actions, so every later ticket can write tests at this seam. See the spec's Testing Decisions.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Expo + TypeScript app builds as a development build via EAS and runs on the iOS simulator
- [ ] Sign in with Apple and Sign in with Google work through Supabase Auth; signing out returns to the sign-in screen
- [ ] A Profile is created for each new user on first sign-in
- [ ] After sign-in the user sees an empty library screen
- [ ] Local Supabase starts from the repo with migrations applied in one command
- [ ] The test harness signs in at least two test users and calls data-layer actions as each
- [ ] One passing data-layer test: a signed-in user can read their own Profile and not another user's
- [ ] A short README section explains how to run the app, local Supabase and the tests
