# Coding standards

Rules a reviewer can check against a diff. `[tool]` marks rules `npm run verify` already enforces; the rest are for review.

Run `npm run verify` (typecheck, lint, database types freshness, tests) before every commit. It must be green.

## Data layer (`src/data`)

- [tool] Only `src/data` imports `@supabase/*`. Screens, components and `src/auth` call actions on `data` from `src/data/app.ts`.
- Every read and write the UI needs is a named action returned by `createDataLayer(client)`, named in the domain's words (`createRecipe`, `setPantry`, `checkOff`), as the spec's Modules list shows.
- Actions throw `DataError` with a stable `code`, never raw Supabase errors (use `fail()`).
- Ids are branded types (`UserId`, and `RecipeId`, `IngredientId`… as they arrive) built only by a `parseXxxId` function in `src/data/types.ts`. Parse at the boundary: every id coming out of a row or a session goes through its parser. The parser is the only place a brand cast is allowed (with the existing `eslint-disable` comment).
- [tool] No `any`, no `as` type assertions.
- Domain types in `src/data/types.ts` are hand-written (`camelCase`, branded ids). Never re-export or alias a generated row type (`Database[...]['Row']`); map rows to domain types with a `toXxx(row)` function inside the data layer.
- Model states as discriminated unions on a `status` (or `kind`) field, like `SessionState`. No pairs of booleans such as `isDraft` + `isReviewed`.
- Pure engines (list engine, ranking engine, ingredient matcher) are plain functions with no I/O and no Supabase types, in `src/data/<engine>.ts` or a sibling module such as `src/lists/`. Only data-layer actions call them; screens never do.
- Add exports to `src/data/index.ts` only for what screens or tests need.

## Database (`supabase/`)

- Row-level security is the only access control. Every new table enables RLS, grants only what the Data API needs, and has policies scoped to `(select auth.uid())`. No visibility checks in TypeScript as a substitute.
- One migration per ticket: `supabase migration new <ticket-slug>`. Don't edit a migration from an earlier ticket; add a new one.
- After changing the migration: `npm run db:reset`, then `npm run db:types`, and commit `src/data/database.types.ts`. [tool] `verify` fails if the types are stale.
- Functions that need `security definer` set `search_path = ''` and qualify every name.

## Tests (`tests/`)

- Tests call data-layer actions as real users from `signInTestUser()` in `tests/harness.ts`. Use two or more users to prove access rules (one owner, one stranger or Friend).
- [tool] Test files may not import `@supabase/*` or call `.from(` / `.rpc(`. Only `tests/harness.ts` and `tests/global-setup.ts` touch Supabase directly.
- Assert literal expected values (`toEqual([{ name: 'garlic', amounts: [...] }])`), not values recomputed with the code under test.
- Assert what each user can see afterwards, not table contents.
- Each ticket's acceptance criteria that say "data-layer test" map to at least one named test.
- `vi.mock` is only for native modules that can't run in Node (as in `tests/apple-sign-in.test.ts`) and for the source reader and Claude call. Never mock the data layer in a data-layer test.

## Naming

- Use `GLOSSARY.md` terms in code, tests, migrations and UI copy: Recipe, Ingredient, Pantry, Staple, Shopping List, Draft. Not their _Avoid_ synonyms (item, inventory, grocery list, import).
- Tables are plural snake_case of the glossary term (`recipes`, `pantry_entries`, `shopping_list_items`).

## UI (`src/ui`)

- Screens and components draw with the primitives and tokens exported from `src/ui` (`Screen`, `Text`, `Button`, `ListRow`, `colors`, `spacing`, `radii`…). See `docs/design.md`.
- [tool] No raw colours (hex, `rgb(`, `hsl(`) and no numeric `fontSize` in `src/app` or `src/components`. Name a colour role (`colors.textMuted`) and a `Text` variant (`<Text variant="caption">`).
- A new visual pattern goes into `src/ui` first, as a small primitive in the domain's words, and is added to the dev gallery (`src/app/dev/ui.tsx`) with sample data. Then screens use it.
- Interactive primitives set an `accessibilityLabel` from their visible text, so icon glyphs don't leak into labels (and Maestro can tap them by text).

## Screens (`src/app`)

- Screens hold UI state only. Data comes from data-layer actions; no business rules in components.
- Each ticket with UI adds or updates a Maestro flow in `.maestro/` and proves it with `npm run e2e` (see `docs/agents/verify.md`).
- Prefer JS-only libraries. A native module needs a new EAS development build (see `docs/agents/verify.md`).
