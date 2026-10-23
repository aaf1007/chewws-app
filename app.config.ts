import type { ConfigContext, ExpoConfig } from 'expo/config';

const GOOGLE_CLIENT_SUFFIX = '.apps.googleusercontent.com';

// The Google plugin needs the iOS client id reversed as a URL scheme. Without a client id we leave
// the plugin out so prebuild still works; the app then reports Google sign-in as not configured.
function googleSignInPlugin(): [string, { iosUrlScheme: string }][] {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iosClientId) return [];
  if (!iosClientId.endsWith(GOOGLE_CLIENT_SUFFIX)) {
    throw new Error(`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must end with ${GOOGLE_CLIENT_SUFFIX}`);
  }
  const id = iosClientId.slice(0, -GOOGLE_CLIENT_SUFFIX.length);
  return [['@react-native-google-signin/google-signin', { iosUrlScheme: `com.googleusercontent.apps.${id}` }]];
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'recipeapp',
  slug: 'recipeapp',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'recipeapp',
  userInterfaceStyle: 'automatic',
  ios: {
    icon: './assets/expo.icon',
    bundleIdentifier: 'com.ant1007.recipeapp',
    usesAppleSignIn: true,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'com.ant1007.recipeapp',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#208AEF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    'expo-apple-authentication',
    ...googleSignInPlugin(),
  ],
  owner: 'ant1007',
  extra: {
    eas: { projectId: '5fd5ebaa-7659-4c82-acd5-a522df605dec' },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
