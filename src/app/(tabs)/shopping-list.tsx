import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import {
  friendsListName,
  type ListSync,
  type NotSavedListChange,
  type SharedShoppingList,
  type ShoppingList as List,
  type ShoppingListId,
  type ShoppingListItem,
  type ShoppingListView,
  type UserId,
} from '@/data';
import { data } from '@/data/app';
import { useSession } from '@/session';
import {
  AddField,
  Button,
  EmptyState,
  ListSwitcher,
  NavRow,
  Screen,
  SectionHeader,
  ShoppingListRow,
  SyncNotice,
  Text,
  type ListSwitcherOption,
} from '@/ui';

/** Which list the tab shows: the user's own, or a Friend's shared with them. */
type Selected = 'mine' | ShoppingListId;

/** Each Recipe's amounts under an Ingredient line: "Aglio e olio · 4 cloves, 1 clove". */
const amountsOf = (item: ShoppingListItem) =>
  item.kind === 'ingredient'
    ? item.recipes.map(({ recipe, amountTexts }) =>
        amountTexts.length > 0 ? `${recipe.title} · ${amountTexts.join(', ')}` : recipe.title,
      )
    : [];

/**
 * On a list more than one person uses, who checked an item off: "you", "@sam", or "a former Friend"
 * once they're neither its owner nor shared with (decisions 13).
 */
function checkedByOf(item: ShoppingListItem, list: List, me: UserId | null): string | null {
  if (item.check.status !== 'checked' || (list.sharedWith.length === 0 && list.ownerId === me)) return null;
  const { checkedBy } = item.check;
  if (checkedBy === me) return 'Checked off by you';
  const people = [{ id: list.ownerId, username: list.ownerUsername }, ...list.sharedWith];
  const username = people.find((p) => p.id === checkedBy)?.username;
  return `Checked off by ${username ? `@${username}` : 'a former Friend'}`;
}

const nameOf = (item: ShoppingListItem) => (item.kind === 'ingredient' ? item.ingredient.name : item.text);

const changes = (count: number) => (count === 1 ? '1 change' : `${count} changes`);

/** What to tell the user about changes made on this phone that the server doesn't have yet. */
function syncNoticeOf(sync: ListSync): { status: 'offline' | 'syncing' | 'retrying'; message: string } | null {
  if (sync.status === 'offline') {
    return {
      status: 'offline',
      message:
        sync.waiting > 0
          ? `You're offline. ${changes(sync.waiting)} will sync when you're back online.`
          : "You're offline. This is your list as it was last loaded.",
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
};

/** "Couldn't check off Foil." */
const notSavedMessage = ({ kind, itemName }: NotSavedListChange) => `Couldn't ${VERB[kind]} ${itemName}.`;

/** "Sam's list isn't shared with you any more. 2 changes weren't saved." */
function noLongerSharedMessage(ownerUsername: string | null, changesNotSaved: number) {
  const lost =
    changesNotSaved === 0 ? '' : ` ${changes(changesNotSaved)} ${changesNotSaved === 1 ? "wasn't" : "weren't"} saved.`;
  return `${friendsListName(ownerUsername)} isn't shared with you any more.${lost}`;
}

const sharedWithDetail = (list: List | null) =>
  list && list.sharedWith.length > 0
    ? `Shared with ${list.sharedWith.map((p) => (p.username ? `@${p.username}` : 'a Friend')).join(', ')}`
    : 'Only you can see it';

const loading: ShoppingListView = { status: 'loading', sync: { status: 'idle', waiting: 0 }, notSaved: [] };

export default function ShoppingList() {
  const session = useSession();
  const me = session.status === 'signedIn' ? session.userId : null;
  const [selected, setSelected] = useState<Selected>('mine');
  const [shared, setShared] = useState<SharedShoppingList[]>([]);
  const [state, setState] = useState<ShoppingListView>(loading);
  const [changeError, setChangeError] = useState<string | null>(null);
  const listId = selected === 'mine' ? undefined : selected;
  const mine = selected === 'mine';

  // Friends' lists shared with the user, for the switcher, each time the tab opens (and after
  // leaving one, or being told one isn't shared any more).
  const loadShared = useCallback(() => {
    let live = true;
    data
      .listSharedShoppingLists()
      .then((lists) => live && setShared(lists))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useFocusEffect(loadShared);

  // The list as the phone has it, updated on every change (sent or still waiting for a signal),
  // whenever it's read from the server, and whenever anyone changes it, while this tab is open.
  useFocusEffect(
    useCallback(() => {
      setState(loading);
      return data.watchShoppingList(setState, { listId });
    }, [listId]),
  );

  const choose = (next: Selected) => {
    setChangeError(null);
    setSelected(next);
  };

  /** Makes a change; the list shows it as it happens. If it fails, shows why and rejects. */
  const change = (run: () => Promise<unknown>) => {
    setChangeError(null);
    return run().catch((e: unknown) => {
      setChangeError(messageOf(e));
      throw e;
    });
  };
  /** For a row's button, whose failure is already shown by `change`. */
  const changeFromRow = (run: () => Promise<unknown>) => () => {
    change(run).catch(() => {});
  };

  const list = state.status === 'loaded' ? state.list : null;
  const owner = list?.ownerUsername ?? shared.find((l) => l.id === selected)?.owner.username ?? null;

  const row = (item: ShoppingListItem) => {
    const checked = item.check.status === 'checked';
    const checkedBy = list ? checkedByOf(item, list, me) : null;
    // A Friend removes only what was added by hand; the lines from the owner's Recipes are theirs.
    const removable = mine || item.kind === 'handAdded';
    return (
      <ShoppingListRow
        key={item.id}
        name={nameOf(item)}
        details={checkedBy ? [...amountsOf(item), checkedBy] : amountsOf(item)}
        check={{
          checked,
          onPress: changeFromRow(() => (checked ? data.uncheck(item.id, { listId }) : data.checkOff(item.id, { listId }))),
        }}
        action={removable ? { label: 'Remove', onPress: changeFromRow(() => data.removeFromShoppingList(item.id)) } : undefined}
      />
    );
  };

  const leave = () => {
    if (!listId) return;
    Alert.alert(`Leave ${friendsListName(owner)}?`, "You won't see it any more. They can share it with you again.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          change(() => data.leaveSharedShoppingList(listId))
            .then(() => {
              choose('mine');
              loadShared();
            })
            .catch(() => {});
        },
      },
    ]);
  };

  const notice = state.status === 'failed' || state.status === 'noLongerShared' ? null : syncNoticeOf(state.sync);
  const items = list?.items ?? [];
  const toBuy = items.filter((item) => item.check.status === 'unchecked');
  const checkedOff = items.filter((item) => item.check.status === 'checked');
  const recipes = list?.recipes ?? [];
  const switcher: ListSwitcherOption<Selected>[] = [
    { value: 'mine', label: 'Your list' },
    ...shared.map((l) => ({ value: l.id, label: friendsListName(l.owner.username) })),
  ];

  return (
    <Screen title="Shopping List" scroll>
      {shared.length > 0 || !mine ? (
        <ListSwitcher options={switcher} value={selected} onChange={choose} testID="shopping-list-switcher" />
      ) : null}
      {state.status === 'noLongerShared' ? (
        <SyncNotice
          status="notSaved"
          message={noLongerSharedMessage(state.ownerUsername, state.changesNotSaved)}
          action={{
            label: 'OK',
            onPress: () => {
              if (listId) void data.dismissNoLongerShared(listId);
              choose('mine');
              loadShared();
            },
          }}
          testID="shopping-list-not-shared"
        />
      ) : (
        <AddField
          onSubmit={(text) => change(() => data.addManualItem(text, { listId }))}
          placeholder={mine ? 'Add something to buy' : `Add to ${friendsListName(owner)}`}
          testID="shopping-list-add"
        />
      )}
      {mine ? (
        <NavRow
          icon="people-outline"
          label="Share your list"
          detail={sharedWithDetail(list)}
          onPress={() => router.push('/share-shopping-list')}
          testID="share-shopping-list"
        />
      ) : null}
      {notice ? <SyncNotice status={notice.status} message={notice.message} testID="shopping-list-sync" /> : null}
      {state.notSaved.map((change, i) => (
        <SyncNotice
          key={i}
          status="notSaved"
          message={notSavedMessage(change)}
          action={i === state.notSaved.length - 1 ? { label: 'OK', onPress: () => void data.dismissNotSavedListChanges() } : undefined}
          testID="shopping-list-not-saved"
        />
      ))}
      {changeError ? <Text tone="danger">{changeError}</Text> : null}
      {state.status === 'failed' ? <Text tone="danger">{state.error.message}</Text> : null}

      {list && items.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title={mine ? 'Your Shopping List is empty' : `${friendsListName(owner)} is empty`}
          message={
            mine
              ? "Add a Recipe to get the Ingredients it needs that aren't in your Pantry, or add anything by hand."
              : 'Add anything by hand. What you check off goes in their Pantry.'
          }
        />
      ) : null}

      {toBuy.length > 0 ? (
        <View>
          <SectionHeader title="To buy" />
          {toBuy.map(row)}
        </View>
      ) : null}

      {checkedOff.length > 0 ? (
        <View>
          <SectionHeader title="Checked off" />
          <Text variant="caption" tone="textMuted">
            {mine
              ? 'Ingredients you check off go in your Pantry.'
              : `Ingredients you check off go in ${owner ? `@${owner}'s` : 'their'} Pantry.`}
          </Text>
          {checkedOff.map(row)}
        </View>
      ) : null}

      {recipes.length > 0 ? (
        <View>
          <SectionHeader title="From Recipes" />
          <Text variant="caption" tone="textMuted">
            {mine
              ? 'Removing a Recipe takes off its amounts, and every line only it needs.'
              : `Only ${owner ? `@${owner}` : 'the owner'} can take their Recipes off the list.`}
          </Text>
          {recipes.map((recipe) => (
            <ShoppingListRow
              key={recipe.id}
              name={recipe.title}
              action={
                mine
                  ? { label: 'Remove', onPress: changeFromRow(() => data.removeRecipeFromShoppingList(recipe.id)) }
                  : undefined
              }
            />
          ))}
        </View>
      ) : null}

      {!mine && list ? <Button label={`Leave ${friendsListName(owner)}`} variant="plain" onPress={leave} /> : null}
    </Screen>
  );
}
