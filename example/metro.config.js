const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withLyrelog } = require('../metro');

// The library is the repo root (one level up), and the workspace keeps one node_modules there.
const root = path.resolve(__dirname, '..');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')],
  },
};

// withLyrelog: release bundles get their debug ids, for readable stacks (../metro.js).
module.exports = withLyrelog(mergeConfig(getDefaultConfig(__dirname), config));
