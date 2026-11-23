const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The library is the repo root (one level up), and the workspace keeps one node_modules there.
const root = path.resolve(__dirname, '..');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
