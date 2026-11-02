/** How a Friend's Shopping List is named: "Sam's list" (from `sam`), or a former Friend's when unknown. */
export function friendsListName(ownerUsername: string | null): string {
  if (!ownerUsername) return "A former Friend's list";
  return `${ownerUsername.slice(0, 1).toUpperCase()}${ownerUsername.slice(1)}'s list`;
}
