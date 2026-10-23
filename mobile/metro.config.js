const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const config = getDefaultConfig(projectRoot);

// Only the packages the app imports — watching all of jobmagnet (knowledge/,
// Electron, archives) makes Metro hang on startup (host shows as Lovelace).
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages/core'),
  path.resolve(workspaceRoot, 'packages/llm'),
  path.resolve(workspaceRoot, 'packages/browser-scripts'),
  path.resolve(workspaceRoot, 'lib'),
];

config.resolver.platforms = ['ios', 'android', 'native'];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
const shim = (name) => path.resolve(projectRoot, 'shims', name);
config.resolver.extraNodeModules = {
  '@jobmagnet/core': path.resolve(workspaceRoot, 'packages/core'),
  '@jobmagnet/browser-scripts': path.resolve(workspaceRoot, 'packages/browser-scripts'),
  '@jobmagnet/llm': path.resolve(workspaceRoot, 'packages/llm'),
  fs: shim('fs.js'),
  crypto: shim('crypto.js'),
  'js-yaml': shim('js-yaml.js'),
};

const escape = (s) => s.replace(/[/\\]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(`${escape(workspaceRoot)}/knowledge/.*`),
  new RegExp(`${escape(workspaceRoot)}/mobile/\\.expo/.*`),
  new RegExp(`${escape(workspaceRoot)}/lib/store/index\\.js`),
];

module.exports = config;
