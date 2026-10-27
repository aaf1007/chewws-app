// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo CLI rewrites .expo/devices.json each time the dev build launches. Metro took that for a
// source change and sent the app a hot update, so the app showed "Refreshing..." a few seconds
// after launch, and while that banner's full-screen window was up it swallowed every tap. Nothing
// under .expo is app source, so Metro doesn't watch it.
config.resolver.blockList = [
  ...[config.resolver.blockList].flat(),
  /(^|[\\/])\.expo[\\/]/,
];

module.exports = config;
