import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signInWithApple } from '@/auth/apple';
import { messageOf } from '@/auth/errors';
import { googleNotConfiguredMessage, isGoogleConfigured, signInWithGoogle } from '@/auth/google';
import { DevSignInButton } from '@/components/dev-sign-in-button';

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
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>Recipe App</Text>
        <Text style={styles.subtitle}>Save recipes from the videos you watch.</Text>
      </View>

      <View style={styles.buttons}>
        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={8}
            style={styles.appleButton}
            onPress={() => run(signInWithApple)}
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          style={styles.googleButton}
          onPress={() =>
            isGoogleConfigured ? run(signInWithGoogle) : setError(googleNotConfiguredMessage)
          }>
          <Text style={styles.googleLabel}>Sign in with Google</Text>
        </Pressable>

        <DevSignInButton onError={(e) => setError(messageOf(e))} />

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: 24, backgroundColor: '#fff' },
  hero: { flex: 1, justifyContent: 'center', gap: 8 },
  title: { fontSize: 34, fontWeight: '700' },
  subtitle: { fontSize: 17, color: '#666' },
  buttons: { gap: 12, paddingBottom: 16 },
  appleButton: { height: 48 },
  googleButton: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  googleLabel: { fontSize: 17, fontWeight: '500', color: '#1f1f1f' },
  error: { color: '#c62828', textAlign: 'center' },
});
