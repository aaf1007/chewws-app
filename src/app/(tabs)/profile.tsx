import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { data } from '@/data/app';
import { Button, Screen, SectionHeader, Text, spacing } from '@/ui';

export default function Profile() {
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen title="Profile">
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Account" />
        {/* In the screen body, not the header: the dev client's floating tools button starts over
            the header's right-hand corner and took the first tap on a header button there. */}
        <Button
          label="Sign out"
          variant="outlined"
          icon="log-out-outline"
          onPress={() => {
            setError(null);
            data.signOut().catch((e: unknown) => setError(messageOf(e)));
          }}
        />
        {error ? <Text tone="danger">{error}</Text> : null}
      </View>

      {__DEV__ ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="Developer" />
          <Button
            label="UI gallery (dev)"
            variant="plain"
            icon="color-palette-outline"
            onPress={() => router.push('/dev/ui')}
          />
        </View>
      ) : null}
    </Screen>
  );
}
