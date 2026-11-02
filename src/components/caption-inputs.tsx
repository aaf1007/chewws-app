import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { ScreenshotField, Text, TextField, spacing } from '@/ui';

import { pickScreenshot, type PreparedScreenshot } from './screenshot';

/** What the user added for the Draft builder to read: a pasted caption and a screenshot. */
export type AddedCaption = { caption: string; screenshot: PreparedScreenshot | null };

export const NOTHING_ADDED: AddedCaption = { caption: '', screenshot: null };

export const hasAddedCaption = (added: AddedCaption) => added.caption.trim() !== '' || added.screenshot !== null;

/**
 * Text shared along with a link, as the caption to start from: kept whole (a recipe-site link in it
 * is followed) when it says anything besides links, else nothing.
 */
export function captionFromShared(text: string | undefined): string {
  return text && text.replace(/https?:\/\/\S+/giu, '').trim() !== '' ? text.trim() : '';
}

/**
 * "Paste caption" and "Add screenshot", for a link the app can't read itself (an Instagram Reel,
 * a source that gave no caption): both may be used together.
 */
export function CaptionInputs({
  value,
  onChange,
  captionLabel = 'Paste caption',
  placeholder = 'Paste the caption here',
  disabled = false,
}: {
  value: AddedCaption;
  onChange: (next: AddedCaption) => void;
  captionLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    setAdding(true);
    setError(null);
    pickScreenshot()
      .then((screenshot) => {
        if (screenshot) onChange({ ...value, screenshot });
      })
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setAdding(false));
  };

  return (
    <View style={{ gap: spacing.md }}>
      <TextField
        label={captionLabel}
        value={value.caption}
        onChangeText={(caption) => onChange({ ...value, caption })}
        placeholder={placeholder}
        multiline
        testID="paste-caption"
      />
      <ScreenshotField
        imageUri={value.screenshot?.uri ?? null}
        onAdd={add}
        onRemove={() => onChange({ ...value, screenshot: null })}
        adding={adding}
        disabled={disabled}
      />
      {error ? <Text tone="danger">{error}</Text> : null}
    </View>
  );
}
