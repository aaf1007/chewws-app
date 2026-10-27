// The share extension (expo-share-intent) opens the app at `recipeapp://dataUrl=recipeappShareKey…`,
// which is no screen. Land on the Library instead; the root layout reads what was shared and opens
// the save screen with it, as `recipeapp://save?url=…` does.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return path.includes('dataUrl=') ? '/' : path;
}
