import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { data } from '@/data/app';

export default function Library() {
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => data.signOut().catch((e: unknown) => setError(messageOf(e)))}>
              <Text style={styles.signOut}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
      <Text style={styles.empty}>No recipes yet</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  empty: { fontSize: 17, color: '#666' },
  signOut: { fontSize: 17, color: '#007AFF' },
  error: { color: '#c62828', textAlign: 'center' },
});
