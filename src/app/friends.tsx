import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { useWhileFocused } from '@/components/use-while-focused';
import { usernameSearchQuery, type FoundUser, type FriendRequestResult } from '@/data';
import { data } from '@/data/app';
import { askAfterFriendRequest, notificationPermission, registerForDraftReady, type NotificationPermission } from '@/notifications';
import {
  EmptyState,
  NavRow,
  PersonRow,
  Screen,
  SearchField,
  SectionHeader,
  Text,
  spacing,
  type PersonAction,
} from '@/ui';

/** How long typing pauses before the search goes out. */
const SEARCH_DELAY_MS = 250;

async function loadFriends() {
  const [friends, requests] = await Promise.all([data.listFriends(), data.listFriendRequests()]);
  return { friends, requests };
}

const since = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Why the app asks for notifications, in one line, before the system does (decisions 11). */
const NOTIFICATIONS_REASON = 'Notifications are how you hear when someone asks to be Friends.';

/** The reason, as an alert: true if the user goes on to the system's question. */
const explainNotifications = () =>
  new Promise<boolean>((resolve) =>
    Alert.alert('Hear about friend requests', NOTIFICATIONS_REASON, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) },
    ]),
  );

/** What the screen says after "Add", when it didn't simply send. */
function sendMessage({ status }: FriendRequestResult, username: string): string | null {
  switch (status) {
    case 'tooMany':
      return 'You have 50 friend requests waiting for an answer. Cancel some to send more.';
    case 'notFound':
      return `@${username} can't be found any more.`;
    case 'noUsername':
      return 'Choose a username before asking anyone to be Friends.';
    default:
      return null;
  }
}

/**
 * Friends, from Profile or a tapped "Friend request": find people by username and ask them,
 * answer requests (listed first), see and unfriend Friends, and cancel requests not answered yet.
 */
export default function Friends() {
  const [state, reload] = useWhileFocused(loadFriends);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  // "Turn on notifications" shows while they're undecided.
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const checkPermission = useCallback(() => {
    void notificationPermission().then(setPermission);
  }, []);
  useFocusEffect(checkPermission);
  /** After a request sent or accepted: the reason, then the system's question, once. */
  const askForNotifications = () => {
    void askAfterFriendRequest(explainNotifications).then(checkPermission);
  };

  // The users found for the query as typed; a search for an older query, answering late, is dropped.
  const [found, setFound] = useState<{ query: string; users: FoundUser[] } | null>(null);
  useEffect(() => {
    if (query.trim() === '') return;
    let live = true;
    const timer = setTimeout(() => {
      data
        .searchUsers(query)
        .then((users) => live && setFound({ query, users }))
        .catch((e: unknown) => live && setError(messageOf(e)));
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, round]);
  const results = found !== null && found.query === query ? found.users : null;

  /** Runs a change, then shows the lists and any search as they are now. */
  const change = (run: () => Promise<string | null | void>) => () => {
    setError(null);
    run()
      .then((message) => message && setError(message))
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => {
        reload();
        setRound((r) => r + 1);
      });
  };

  const accept = (id: FoundUser['id']): PersonAction => ({
    label: 'Accept',
    onPress: change(async () => {
      if ((await data.respondToFriendRequest(id, true)).status === 'accepted') askForNotifications();
    }),
  });
  const decline = (id: FoundUser['id']): PersonAction => ({
    label: 'Decline',
    tone: 'muted',
    onPress: change(async () => void (await data.respondToFriendRequest(id, false))),
  });
  const cancel = (id: FoundUser['id']): PersonAction => ({
    label: 'Cancel',
    tone: 'muted',
    onPress: change(() => data.cancelFriendRequest(id)),
  });
  const unfriend = (id: FoundUser['id'], username: string): PersonAction => ({
    label: 'Unfriend',
    tone: 'muted',
    onPress: () =>
      Alert.alert(`Unfriend @${username}?`, "You'll no longer be Friends, for either of you.", [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unfriend', style: 'destructive', onPress: change(() => data.unfriend(id)) },
      ]),
  });

  const foundRow = (user: FoundUser) => {
    switch (user.relationship) {
      case 'none':
        return (
          <PersonRow
            key={user.id}
            username={user.username}
            actions={[
              {
                label: 'Add',
                onPress: change(async () => {
                  const result = await data.sendFriendRequest(user.id);
                  if (result.status === 'requested' || result.status === 'accepted') askForNotifications();
                  return sendMessage(result, user.username);
                }),
              },
            ]}
          />
        );
      case 'requestSent':
        return <PersonRow key={user.id} username={user.username} detail="Requested" actions={[cancel(user.id)]} />;
      case 'requestReceived':
        return (
          <PersonRow
            key={user.id}
            username={user.username}
            detail="Wants to be Friends"
            actions={[accept(user.id), decline(user.id)]}
          />
        );
      case 'friends':
        return <PersonRow key={user.id} username={user.username} detail="Friends" />;
    }
  };

  const searching = query.trim() !== '';
  const lists = state.status === 'loaded' ? state.value : null;
  const nothingYet =
    lists !== null &&
    lists.friends.length === 0 &&
    lists.requests.incoming.length === 0 &&
    lists.requests.outgoing.length === 0;

  return (
    <Screen title="Friends" scroll>
      <SearchField value={query} onChangeText={setQuery} placeholder="Find by username" />
      {permission === 'undecided' ? (
        <NavRow
          icon="notifications-outline"
          label="Turn on notifications"
          detail="Hear when someone asks to be Friends"
          onPress={() => void registerForDraftReady({ ask: true }).then(checkPermission)}
          testID="turn-on-notifications"
        />
      ) : null}
      {error ? <Text tone="danger">{error}</Text> : null}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}

      {searching ? (
        <View>
          {usernameSearchQuery(query) === null ? (
            <Text variant="caption" tone="textMuted">
              Type at least 3 letters, numbers or _ of a username.
            </Text>
          ) : results !== null && results.length === 0 ? (
            <Text variant="caption" tone="textMuted">
              No one has a username starting with that.
            </Text>
          ) : results !== null ? (
            results.map(foundRow)
          ) : null}
        </View>
      ) : null}

      {!searching && lists !== null ? (
        <View style={{ gap: spacing.lg }}>
          {lists.requests.incoming.length > 0 ? (
            <View testID="friend-requests">
              <SectionHeader title="Requests" />
              {lists.requests.incoming.map((r) => (
                <PersonRow
                  key={r.id}
                  username={r.username}
                  detail="Wants to be Friends"
                  actions={[accept(r.id), decline(r.id)]}
                />
              ))}
            </View>
          ) : null}
          {lists.friends.length > 0 ? (
            <View testID="friends-list">
              <SectionHeader title="Friends" />
              {lists.friends.map((f) => (
                <PersonRow
                  key={f.id}
                  username={f.username}
                  detail={`Friends since ${since(f.friendsSince)}`}
                  actions={[unfriend(f.id, f.username)]}
                />
              ))}
            </View>
          ) : null}
          {lists.requests.outgoing.length > 0 ? (
            <View testID="friend-requests-sent">
              <SectionHeader title="Sent" />
              {lists.requests.outgoing.map((r) => (
                <PersonRow key={r.id} username={r.username} detail="Requested" actions={[cancel(r.id)]} />
              ))}
            </View>
          ) : null}
          {nothingYet ? (
            <EmptyState
              icon="people-outline"
              title="No Friends yet"
              message="Find people by their username above, and ask them to be Friends."
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
