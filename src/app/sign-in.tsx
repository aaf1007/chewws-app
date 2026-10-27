import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { signInWithApple } from '@/auth/apple';
import { messageOf } from '@/auth/errors';
import { googleNotConfiguredMessage, isGoogleConfigured, signInWithGoogle } from '@/auth/google';
import { DevSignInButton } from '@/components/dev-sign-in-button';
import { Button, Icon, Screen, Text, colors, radii, spacing } from '@/ui';

export default function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  const run = (signIn: () => Promise<unknown>) => {
    setError(null);
    signIn().catch((e: unknown) => setError(messageOf(e)));
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.mark}>
          <Icon name="restaurant" size="xl" tone="onAccent" />
        </View>
        <Text variant="largeTitle">Recipe App</Text>
        <Text tone="textMuted">Save recipes from the videos you watch, then plan, shop and cook.</Text>
      </View>

      <View style={styles.buttons}>
        {appleAvailable ? (
          // Apple's own button, as App Review requires.
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={radii.md}
            style={styles.appleButton}
            onPress={() => run(signInWithApple)}
          />
        ) : null}

        <Button
          label="Sign in with Google"
          variant="outlined"
          icon="logo-google"
          onPress={() =>
            isGoogleConfigured ? run(signInWithGoogle) : setError(googleNotConfiguredMessage)
          }
        />

        <DevSignInButton onError={(e) => setError(messageOf(e))} />

        {error ? (
          <Text variant="caption" tone="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: 'center', gap: spacing.sm },
  mark: {
    width: 72,
    height: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  buttons: { gap: spacing.md, paddingBottom: spacing.sm },
  appleButton: { height: 48 },
  error: { textAlign: 'center' },
});
