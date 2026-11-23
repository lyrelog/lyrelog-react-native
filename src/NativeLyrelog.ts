// The native module's contract (codegen reads this file). Every value crosses as plain JSON:
// `values.ts` makes it so before calling in. Keep it in step with ios/RNLyrelog.mm and
// android/.../LyrelogModule.kt.
import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  /** Starts the native SDK once; a second call is ignored natively. */
  start(config: Object): void;
  /** `payload` arrives wrapped as `{ value }` so any JSON value (a string, an array) fits an object. */
  log(level: string, message: string, category: string | null, attrs: Object | null, payload: Object | null): void;
  /**
   * The same, then waits (blocking the JS thread, at most `timeoutMs`) until the event is on disk
   * and an upload was tried: for a fatal error, when the app is about to end. True when in time.
   */
  logNow(level: string, message: string, category: string | null, attrs: Object | null, payload: Object | null, timeoutMs: number): boolean;
  setUser(id: string | null): void;
  setConsent(consent: string): void;
  screen(name: string, attrs: Object | null): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
  getSessionId(): string | null;
}

export default TurboModuleRegistry.get<Spec>("Lyrelog");
