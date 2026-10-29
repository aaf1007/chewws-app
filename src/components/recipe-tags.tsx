import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import type { RecipeId, Tag } from '@/data';
import { data } from '@/data/app';
import { AddField, SectionHeader, TagChip, TagChips, Text, spacing } from '@/ui';

/**
 * A reviewed Recipe's Tags: each with a × that takes it off, and a field that puts one on by name
 * (the user's Tag of that name, or a new one). Each change is saved at once; `onChanged` reloads.
 */
export function RecipeTags({ recipeId, tags, onChanged }: { recipeId: RecipeId; tags: Tag[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const failed = (e: unknown) => {
    setError(messageOf(e));
    throw e;
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="Tags" />
      {tags.length > 0 ? (
        <TagChips testID="recipe-tags">
          {tags.map((tag) => (
            <TagChip
              key={tag.id}
              name={tag.name}
              onRemove={() => {
                setError(null);
                data
                  .removeTag(recipeId, tag.id)
                  .then(onChanged)
                  .catch((e: unknown) => setError(messageOf(e)));
              }}
            />
          ))}
        </TagChips>
      ) : null}
      <AddField
        placeholder="Add a Tag"
        onSubmit={(name) => {
          setError(null);
          return data.addTag(recipeId, name).then(onChanged, failed);
        }}
        testID="add-tag"
      />
      {error ? <Text tone="danger">{error}</Text> : null}
    </View>
  );
}
