import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { USERNAME_RULE, checkUsername, type SetUsernameResult } from '@/data';
import { data } from '@/data/app';
import { Button, Text, TextField, spacing } from '@/ui';

/** What the screen says when a username isn't taken (decisions 11). */
function refusal(result: Exclude<SetUsernameResult, { status: 'set' }>, typed: string): string {
  const check = checkUsername(typed);
  const name = check.status === 'valid' ? `@${check.username}` : 'That username';
  switch (result.status) {
    case 'taken':
      return `${name} is taken. Try another.`;
    case 'reserved':
      return `${name} isn't available. Try another.`;
    case 'invalid':
      return USERNAME_RULE;
  }
}

/**
 * A username field with its rule and a button that saves it (`setUsername`). Tells the user
 * straight away when what they typed breaks the rule, and why the server refused it otherwise.
 * `onSet` runs once the name is theirs.
 */
export function UsernameForm({
  initial = '',
  submitLabel,
  onSet,
}: {
  initial?: string;
  submitLabel: string;
  onSet: (username: string) => void;
}) {
  const [typed, setTyped] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = () => {
    setError(null);
    if (checkUsername(typed).status === 'invalid') {
      setError(USERNAME_RULE);
      return;
    }
    setSaving(true);
    data
      .setUsername(typed)
      .then((result) => {
        if (result.status === 'set') onSet(result.username);
        else setError(refusal(result, typed));
      })
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setSaving(false));
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <TextField
          label="Username"
          value={typed}
          onChangeText={setTyped}
          placeholder="e.g. rosa_cooks"
          autoCapitalize="none"
          testID="username-field"
        />
        <Text variant="caption" tone={error ? 'danger' : 'textMuted'} testID="username-message">
          {error ?? `${USERNAME_RULE}.`}
        </Text>
      </View>
      <Button label={submitLabel} onPress={save} disabled={saving || typed.trim() === ''} testID="username-save" />
    </View>
  );
}
