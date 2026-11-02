/** When two people became Friends, as the app writes it: "Friends since 2 Nov 2026". */
export const friendsSince = (iso: string) =>
  `Friends since ${new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
