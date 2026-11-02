import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { UsernameForm } from '@/components/username-form';
import { data } from '@/data/app';
import { useUsernameGate } from '@/session';
import { Button, Screen, Text, spacing } from '@/ui';

/** After sign-in, before the tabs, for anyone without a username yet (decisions 11). */
export default function ChooseUsername() {
  const { chosen } = useUsernameGate();
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen title="Choose a username" scroll>
      <Text tone="textMuted">Friends find you by your username. You can change it later.</Text>
      <UsernameForm submitLabel="Continue" onSet={chosen} />
      <View style={{ gap: spacing.sm }}>
        <Button
          label="Sign out"
          variant="plain"
          onPress={() => {
            setError(null);
            data.signOut().catch((e: unknown) => setError(messageOf(e)));
          }}
        />
        {error ? <Text tone="danger">{error}</Text> : null}
      </View>
    </Screen>
  );
}
