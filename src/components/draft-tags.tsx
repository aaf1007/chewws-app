import { useState } from 'react';
import { View } from 'react-native';

import { checkTagName, tagKey } from '@/data';
import { AddField, SectionHeader, SuggestedTagChip, TagChips, Text, spacing } from '@/ui';

/** A Tag name on a Draft and whether the user keeps it; kept ones are saved with the review. */
export type DraftTag = { name: string; kept: boolean };

/** The Draft's suggested Tags, all kept to begin with (decisions, user decision 6). */
export const suggestedDraftTags = (names: string[]): DraftTag[] => names.map((name) => ({ name, kept: true }));

export const keptTagNames = (tags: DraftTag[]) => tags.filter((t) => t.kept).map((t) => t.name);

/**
 * The Tags a Draft will get when it's reviewed: the suggested ones as chips to keep or leave out,
 * and a field to add more. Nothing is saved until the review.
 */
export function DraftTags({ value, onChange }: { value: DraftTag[]; onChange: (tags: DraftTag[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const add = async (typed: string) => {
    const check = checkTagName(typed);
    if (check.status === 'invalid') {
      setError(check.message);
      throw new Error(check.message);
    }
    setError(null);
    const same = value.find((t) => tagKey(t.name) === tagKey(check.name));
    onChange(
      same ? value.map((t) => (t === same ? { ...t, kept: true } : t)) : [...value, { name: check.name, kept: true }],
    );
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="Tags" />
      {value.length > 0 ? (
        <TagChips testID="draft-tags">
          {value.map((tag) => (
            <SuggestedTagChip
              key={tagKey(tag.name)}
              name={tag.name}
              selected={tag.kept}
              onPress={() => onChange(value.map((t) => (t === tag ? { ...t, kept: !t.kept } : t)))}
            />
          ))}
        </TagChips>
      ) : null}
      <AddField placeholder="Add a Tag" onSubmit={add} testID="add-tag" />
      {error ? <Text tone="danger">{error}</Text> : null}
    </View>
  );
}
