<p align="center">
  <a href="https://lyrelog.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://lyrelog.com/readme/react-native-dark.png">
      <img alt="Lyrelog for React Native" src="https://lyrelog.com/readme/react-native-light.png" width="600">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://docs.lyrelog.com/sdks/react-native"><b>Documentation</b></a> ·
  <a href="https://docs.lyrelog.com/quickstart">Quickstart</a> ·
  <a href="https://lyrelog.com">lyrelog.com</a>
</p>

Structured logs, JavaScript errors and crashes from your React Native app to
[Lyrelog](https://lyrelog.com), a hosted log service. A thin TurboModule over the Lyrelog Swift
SDK (iOS) and Android SDK: the native SDKs queue on disk, send in batches, retry, keep sessions
and report native crashes; this package adds the JavaScript side (uncaught errors, unhandled
promise rejections, React render errors, React Navigation screens).

React Native 0.80 or later (before 1.0) with the New Architecture, React 19. iOS 16 and
Android 7.0 (API 24) or later. Version 0.9.0, over the Swift and Android SDKs 0.9.0.

## Install

Not published yet. Once it is:

```sh
pnpm add @lyrelog/react-native
cd ios && pod install
```

iOS: the pod pulls the `Lyrelog` Swift package through SwiftPM (`spm_dependency`). Your app's
deployment target must be 16.0 or later. Android: Gradle fetches
`com.lyrelog:lyrelog-android` from Maven Central.

## Use

Start once, as early as possible, in `index.js` before `AppRegistry`:

```ts
import { Lyrelog } from "@lyrelog/react-native";

Lyrelog.init({
  apiKey: "lyr_ing_...",   // ingest-only: it can append events, never read them
  consent: "granted",      // or "pending" until the person chooses
});                        // endpoint: https://ingest.lyrelog.com unless you pass one

Lyrelog.setUser(playerId);
Lyrelog.info("level_cleared", { attrs: { level: 12, moves: 31 } });
Lyrelog.error("sync_failed", { category: "sync", attrs: { code: 503 }, payload: { response } });

const checkout = Lyrelog.logger("checkout");
checkout.warning("card_declined", { attrs: { code: 51 } });

try {
  await purchase();
} catch (error) {
  Lyrelog.captureError(error, { category: "store" });
}
```

Levels: `trace`, `debug`, `info`, `notice`, `warning`, `error`, `critical`, or
`log(level, message, options)`. Nothing here throws into your app, and every call before `init`
is ignored (except `setUser` and `setConsent`, which apply from the start).

`captureError` records the `exception` event every Lyrelog SDK sends. `captureException` is the
name it had before 0.9.0, kept as a deprecated alias. `setUser` takes a string; a number from
plain JavaScript is sent as its text (`12345` as `"12345"`), and `null` or `undefined` clears it.

What one call carries is bounded before it crosses to the native SDK: 65,536 characters per
string, 131,072 characters of strings and keys in all, 5,000 values, 1,000 items per array or
set, 24 levels deep. The message and `error_message` are cut to 65,536 characters. Anything that
isn't JSON (a `Date`, an `Error`, a cycle, a getter that throws) is turned into something that
is; nothing throws. The native SDKs then apply the server's limits: attribute strings cut to
1,024 bytes, attributes 4 levels deep, and a payload over 64 KiB sent as a summary of its first
1 KiB.

### Screens

```tsx
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { trackNavigation } from "@lyrelog/react-native";

const navigationRef = createNavigationContainerRef();

<NavigationContainer ref={navigationRef} {...trackNavigation(navigationRef)}>
```

Each screen React Navigation shows logs `screen_viewed` (with `previous_screen` and
`seconds_on_previous`) and tags the following events with `screen`. Without React Navigation:
`Lyrelog.screen("Settings")`, or `useLyrelogScreen("Settings")` in a component.

### Errors

With `captureErrors` (on by default):

| What happens | Event | `mechanism` |
|---|---|---|
| A fatal JavaScript error (ErrorUtils) | `app_crashed`, critical, area `diagnostics` | `js_fatal` |
| A render error no boundary caught | `app_crashed`, critical, area `diagnostics` | `react_render` |
| A non-fatal error reported to ErrorUtils | `exception`, error, `handled: false` | `js_error` |
| An unhandled promise rejection | `exception`, error, `handled: false` | `unhandled_rejection` |
| An error caught by `<LyrelogErrorBoundary>` | `exception`, error | `error_boundary` |

The payload has the name, message, stack, up to 3 causes and React's component stack. A fatal
error is written to disk before the app goes (waiting up to 1.5 s). Uncaught errors that aren't
fatal are capped at 10 a minute, the same one at most once every 10 seconds
(`Lyrelog.skippedErrors` counts the rest). Every handler that was there before still runs.

```tsx
<LyrelogErrorBoundary category="feed" fallback={({ reset }) => <Retry onPress={reset} />}>
  <Feed />
</LyrelogErrorBoundary>
```

Native crashes are the native SDKs' (`captureCrashes`, on by default): on Android uncaught JVM
exceptions, on iOS MetricKit's crash reports, sent on the next launch as `app_crashed`.

### Consent, flush, close

```ts
Lyrelog.setConsent("granted");  // sends, including what was kept while pending
Lyrelog.setConsent("denied");   // deletes the queue and records nothing more
await Lyrelog.flush();          // rarely needed: going to the background already sends
await Lyrelog.close();          // send what's queued (up to 2 s), then stop
Lyrelog.sessionId;              // for a support screen
```

Consent isn't saved between launches: store the person's choice and pass it to `init`.

### Configuration

`apiKey`, `endpoint`, `consent`, `environment`, `platform`, `minimumLevel`, `flushIntervalMs`,
`sessionTimeoutMs`, `maxDiskBytes`, `redactKeys` (defaults in `DEFAULT_REDACT_KEYS`),
`captureErrors`, `captureCrashes`, `attachScreen`, `attest` (App Attest / Key Attestation, on by
default), `mirrorToNativeLog`. `flushIntervalMs` is at least 1000 (smaller values are raised to
it, as in the native SDKs). The environment is the native SDK's: `development` in debug builds,
`testflight` on TestFlight, else `production`.

### Your app's Jest tests

The package ships ES modules only (no CommonJS build), like most React Native libraries. Let
Jest transform it, next to React Native's own pattern:

```js
// jest.config.js
transformIgnorePatterns: [
  "node_modules/(?!((jest-)?react-native|@react-native(-community)?|@lyrelog/react-native)/)",
],
```

Without the native module (as under Jest) every call does nothing.

## Develop

```sh
pnpm install
pnpm test          # jest, with a fake native module
pnpm typecheck     # the library and the example
```

The example app, Driftwood (`example/`), needs `example/lyrelog.local.json` (copy
`lyrelog.local.example.json`) with a key for the local stack (`make up` in `../lyrelog`).

```sh
cd example && pnpm start                     # Metro
cd example/ios && pod install && open *.xcworkspace
cd example/android && ./gradlew :app:installDebug -PreactNativeArchitectures=arm64-v8a
```

## License

MIT
