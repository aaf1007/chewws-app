import { useState } from 'react';
import { Alert, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { deleteTagConfirmation, recipeCount } from '@/components/tag-copy';
import { useWhileFocused } from '@/components/use-while-focused';
import type { TagWithRecipes } from '@/data';
import { data } from '@/data/app';
import { EmptyState, Screen, TagRow, Text } from '@/ui';

/**
 * The user's Tags (decisions 06, issue 22), opened from the Library's "Tags" row: each by name with
 * how many of their Recipes it's on, a Tag on none at 0. Deleting one asks first, naming the
 * Recipes it comes off; a Tag already gone (deleted on another phone) says so. Read again whenever
 * the screen comes into focus and after each delete.
 */
export default function TagsScreen() {
  const [state, reload] = useWhileFocused(() => data.listTagsWithRecipes());
  const [notice, setNotice] = useState<{ tone: 'textMuted' | 'danger'; text: string } | null>(null);

  const confirmDelete = (tag: TagWithRecipes) => {
    setNotice(null);
    const { title, message } = deleteTagConfirmation(tag);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          data
            .deleteTag(tag.id)
            .then((result) => {
              if (result.status === 'gone') setNotice({ tone: 'textMuted', text: `“${tag.name}” was already deleted.` });
              reload();
            })
            .catch((e: unknown) => setNotice({ tone: 'danger', text: messageOf(e) })),
      },
    ]);
  };

  if (state.status === 'error') {
    return (
      <Screen title="Tags" scroll>
        <EmptyState icon="alert-circle-outline" title="Couldn’t load your Tags" message={state.message} />
      </Screen>
    );
  }
  if (state.status === 'loading') return <Screen title="Tags" scroll />;

  const noticeText = notice ? <Text tone={notice.tone}>{notice.text}</Text> : null;
  if (state.value.length === 0) {
    return (
      <Screen title="Tags" scroll>
        {noticeText}
        <EmptyState
          icon="pricetags-outline"
          title="No Tags yet"
          message="Tags you put on your Recipes show up here, with how many Recipes each is on."
        />
      </Screen>
    );
  }
  return (
    <Screen title="Tags" scroll>
      {noticeText}
      <View testID="tags-list">
        {state.value.map((tag) => (
          <TagRow
            key={tag.id}
            name={tag.name}
            detail={recipeCount(tag)}
            onDelete={() => confirmDelete(tag)}
          />
        ))}
      </View>
    </Screen>
  );
}
