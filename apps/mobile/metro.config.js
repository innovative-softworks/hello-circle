// Metro (unlike Vite) doesn't auto-resolve npm-workspaces symlinked
// packages — without this, `import from '@hello-circle/types'` /
// '@hello-circle/design-tokens' fails to resolve even though npm correctly
// symlinks them into the repo root's node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = withNativeWind(config, { input: './src/global.css' });
