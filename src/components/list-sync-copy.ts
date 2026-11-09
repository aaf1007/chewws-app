import type { ListSync, NotSavedListChange } from '@/data';

/** "1 change", "2 changes". */
export const changes = (count: number) => (count === 1 ? '1 change' : `${count} changes`);

/**
 * What to tell the user about list changes made on this phone that the server doesn't have yet.
 * `lastLoaded` ends the offline message when nothing is waiting: "This is your list as it was last
 * loaded."
 */
export function syncNoticeOf(
  sync: ListSync,
  lastLoaded = 'This is your list as it was last loaded.',
): { status: 'offline' | 'syncing' | 'retrying'; message: string } | null {
  if (sync.status === 'offline') {
    return {
      status: 'offline',
      message:
        sync.waiting > 0 ? `You're offline. ${changes(sync.waiting)} will sync when you're back online.` : `You're offline. ${lastLoaded}`,
    };
  }
  if (sync.status === 'waitingToRetry') {
    return { status: 'retrying', message: `The server had a problem. ${changes(sync.waiting)} will retry shortly.` };
  }
  if (sync.status === 'syncing' && sync.waiting > 0) {
    return { status: 'syncing', message: `Syncing ${changes(sync.waiting)}…` };
  }
  return null;
}

const VERB: Record<NotSavedListChange['kind'], string> = {
  checkOff: 'check off',
  uncheck: 'uncheck',
  addManualItem: 'add',
  claim: 'claim',
  unclaim: 'unclaim',
};

/** "Couldn't check off Foil." */
export const notSavedMessage = ({ kind, itemName }: NotSavedListChange) => `Couldn't ${VERB[kind]} ${itemName}.`;

/** " 2 changes weren't saved." (with its leading space), or nothing for none. */
export const changesNotSavedMessage = (count: number) =>
  count === 0 ? '' : ` ${changes(count)} ${count === 1 ? "wasn't" : "weren't"} saved.`;
