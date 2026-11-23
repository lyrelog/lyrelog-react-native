import { AppRegistry, Platform } from 'react-native';
import { Lyrelog } from '@lyrelog/react-native';
import App from './src/App';
import { name as appName } from './app.json';
// Not committed: copy lyrelog.local.example.json and put a project's ingest key in it.
import local from './lyrelog.local.json';

Lyrelog.init({
  apiKey: local.apiKey,
  endpoint: Platform.OS === 'android' ? local.androidEndpoint : local.iosEndpoint,
  flushIntervalMs: 5000,
  mirrorToNativeLog: true,
});

AppRegistry.registerComponent(appName, () => App);
