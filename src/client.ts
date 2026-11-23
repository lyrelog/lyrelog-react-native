import NativeLyrelog, { type Spec } from "./NativeLyrelog";
import { describe, FloodGuard, installErrorHooks, reactNativeHooks, type Hooks, type Mechanism } from "./errors";
import { cut, toPlain, toPlainObject } from "./values";
import {
  LEVELS,
  type Attributes,
  type Config,
  type Consent,
  type ExceptionOptions,
  type Level,
  type LogOptions,
  type Logger,
} from "./types";

/** What the native SDKs redact when `redactKeys` is left out, the same list in every Lyrelog SDK. */
export const DEFAULT_REDACT_KEYS: readonly string[] = Object.freeze([
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "privatekey",
  "credential",
  "credentials",
  "accesskey",
  "signature",
]);

/** How long a fatal JavaScript error waits for its event to reach the disk before the app ends. */
export const FATAL_WAIT_MS = 1500;

/** The shortest upload interval: smaller `flushIntervalMs` values are raised to it, as in the native SDKs. */
export const MIN_FLUSH_INTERVAL_MS = 1000;

const CONSENTS: readonly Consent[] = ["granted", "pending", "denied"];

/**
 * The one Lyrelog of the app. Every call goes to the native SDK (Swift on iOS, Kotlin on
 * Android), which keeps the queue on disk, batches, retries and proves the app. Nothing here
 * throws or blocks: a failing call is dropped quietly.
 */
export class LyrelogClient {
  private native: Spec | null;
  private started = false;
  private minimum = 1; // debug
  private readonly guard = new FloodGuard();
  private warnedMissing = false;
  private flushing: Promise<void> | null = null;
  private nextFlush: Promise<void> | null = null;

  /** @internal The tests pass a fake native module and fake hooks. */
  constructor(native: Spec | null | undefined = NativeLyrelog, private readonly hooks: () => Hooks = reactNativeHooks) {
    this.native = native ?? null;
  }

  /**
   * Starts Lyrelog. Call it once, as early as possible (`index.js`, before `AppRegistry`). A
   * second call keeps the first configuration (the native SDKs start once per launch) and
   * returns the same client.
   */
  init(config: Config): this {
    try {
      const native = this.module();
      if (!native || this.started) return this;
      if (!config || typeof config.apiKey !== "string" || config.apiKey === "") {
        devWarn("Lyrelog.init needs the project's ingest key (apiKey).");
        return this;
      }
      this.started = true;
      this.minimum = Math.max(0, LEVELS.indexOf(config.minimumLevel ?? "debug"));
      native.start(nativeConfig(config));
      if (config.captureErrors !== false) {
        installErrorHooks(this.hooks(), (error, fatal, mechanism, componentStack) => this.uncaught(error, fatal, mechanism, componentStack));
      }
    } catch {
      // never throws
    }
    return this;
  }

  log(level: Level, message: string, options?: LogOptions): void {
    try {
      if (!this.admits(level) || typeof message !== "string") return;
      this.module()?.log(level, cut(message), category(options?.category), toPlainObject(options?.attrs), wrap(options?.payload));
    } catch {
      // never throws
    }
  }

  trace(message: string, options?: LogOptions): void {
    this.log("trace", message, options);
  }
  debug(message: string, options?: LogOptions): void {
    this.log("debug", message, options);
  }
  info(message: string, options?: LogOptions): void {
    this.log("info", message, options);
  }
  notice(message: string, options?: LogOptions): void {
    this.log("notice", message, options);
  }
  warning(message: string, options?: LogOptions): void {
    this.log("warning", message, options);
  }
  error(message: string, options?: LogOptions): void {
    this.log("error", message, options);
  }
  critical(message: string, options?: LogOptions): void {
    this.log("critical", message, options);
  }

  /** A logger for one area of the app: every event it records carries `category`. */
  logger(name: string): Logger {
    const log = (level: Level, message: string, options?: Omit<LogOptions, "category">) =>
      this.log(level, message, { ...options, category: name });
    return {
      category: name,
      log,
      trace: (m, o) => log("trace", m, o),
      debug: (m, o) => log("debug", m, o),
      info: (m, o) => log("info", m, o),
      notice: (m, o) => log("notice", m, o),
      warning: (m, o) => log("warning", m, o),
      error: (m, o) => log("error", m, o),
      critical: (m, o) => log("critical", m, o),
      captureError: (error, o) => this.captureError(error, { ...o, category: name }),
      captureException: (error, o) => this.captureError(error, { ...o, category: name }),
    };
  }

  /**
   * Your own account id on every following event; `null` or `undefined` clears it. A number
   * (from plain JavaScript) is sent as its text, `12345` as `"12345"`. Before `init`, it applies
   * from the start.
   */
  setUser(id: string | number | null | undefined): void {
    try {
      this.module()?.setUser(userId(id));
    } catch {
      // never throws
    }
  }

  /**
   * The person's choice, applied at once. `pending` keeps events on the device unsent,
   * `granted` sends them, `denied` deletes what's queued (and the install id) and records
   * nothing more. Before `init`, it wins over `Config.consent`.
   */
  setConsent(consent: Consent): void {
    try {
      if (CONSENTS.includes(consent)) this.module()?.setConsent(consent);
    } catch {
      // never throws
    }
  }

  /**
   * Says which screen the person is on: logs `screen_viewed` (with the screen before and the
   * seconds spent on it) and tags every following event with `screen`. The same screen twice
   * in a row is one view.
   */
  screen(name: string, attrs?: Attributes): void {
    try {
      if (!this.started || typeof name !== "string" || name === "") return;
      this.module()?.screen(name, toPlainObject(attrs));
    } catch {
      // never throws
    }
  }

  /**
   * The `exception` event every Lyrelog SDK sends: level `error` (or `options.level`),
   * `error_type` and `error_message` attributes, and the name, message, stack and causes in
   * the payload. Your `attrs` are added; theirs win.
   */
  captureError(error: unknown, options?: ExceptionOptions): void {
    try {
      const level = options?.level ?? "error";
      if (!this.admits(level)) return;
      const described = describe(error, options?.componentStack);
      const attrs = { ...toPlainObject(options?.attrs), error_type: described.type, error_message: described.message };
      this.module()?.log(level, "exception", category(options?.category), attrs, { value: described.payload });
    } catch {
      // never throws
    }
  }

  /** @deprecated Use {@link captureError}, the name every Lyrelog SDK uses. Kept as an alias. */
  captureException(error: unknown, options?: ExceptionOptions): void {
    this.captureError(error, options);
  }

  /** The current session id (to show in a support screen), once started. */
  get sessionId(): string | undefined {
    try {
      return (this.started && this.module()?.getSessionId()) || undefined;
    } catch {
      return undefined;
    }
  }

  /** Writes everything to disk and tries to send it now. Rarely needed: going to the background already sends. */
  async flush(): Promise<void> {
    try {
      if (!this.started) return;
      // One native flush at a time (on Android each one holds a thread up to 5 s); calls made
      // during it share the one that follows, which covers what they logged.
      if (!this.flushing) {
        this.flushing = this.nativeFlush().finally(() => {
          this.flushing = null;
        });
        return await this.flushing;
      }
      this.nextFlush ??= this.flushing.then(() => {
        this.nextFlush = null;
        return this.flush();
      });
      return await this.nextFlush;
    } catch {
      // never throws
    }
  }

  private async nativeFlush(): Promise<void> {
    try {
      await this.module()?.flush();
    } catch {
      // never throws
    }
  }

  /**
   * Sends what was logged (waiting up to 2 seconds) and stops. What couldn't be sent stays on
   * the device for the next launch. `init` can be called again afterwards.
   */
  async close(): Promise<void> {
    try {
      if (!this.started) return;
      this.started = false;
      await this.module()?.stop();
    } catch {
      // never throws
    }
  }

  /** Uncaught errors the flood guard left out (10 a minute, the same one once per 10 s). */
  get skippedErrors(): number {
    return this.guard.skipped;
  }

  // MARK: - Uncaught errors

  private uncaught(error: unknown, fatal: boolean, mechanism: Mechanism, componentStack?: string | null): void {
    if (!this.started) return;
    const native = this.module();
    if (!native) return;
    const described = describe(error, componentStack);
    const attrs = { error_type: described.type, error_message: described.message, handled: false, mechanism };
    if (fatal) {
      // The app is about to end (a release build stops on a fatal error): like the native
      // crash reports, `app_crashed`, critical, area `diagnostics`, written to disk before it goes.
      native.logNow("critical", "app_crashed", "diagnostics", attrs, { value: described.payload }, FATAL_WAIT_MS);
      return;
    }
    if (!this.admits("error") || !this.guard.admit(error)) return;
    native.log("error", "exception", null, attrs, { value: described.payload });
  }

  private admits(level: Level): boolean {
    const index = LEVELS.indexOf(level);
    return this.started && index >= 0 && index >= this.minimum;
  }

  private module(): Spec | null {
    if (!this.native && !this.warnedMissing) {
      this.warnedMissing = true;
      devWarn(
        "Lyrelog's native module isn't linked: rebuild the app after installing @lyrelog/react-native (pod install on iOS). Expo Go can't load it; use a development build.",
      );
    }
    return this.native;
  }
}

function userId(id: unknown): string | null {
  if (typeof id === "string") return id !== "" ? id : null;
  // Plain JavaScript can pass a number; it is still an id, not a request to clear it.
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "bigint") return String(id);
  return null;
}

function category(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function wrap(payload: unknown): { value: unknown } | null {
  if (payload === undefined) return null;
  return { value: toPlain(payload) };
}

/** Only what was set crosses; the native SDKs fill in their own defaults for the rest. */
export function nativeConfig(config: Config): Record<string, unknown> {
  const out: Record<string, unknown> = { apiKey: config.apiKey };
  const strings = ["endpoint", "environment", "platform", "consent", "minimumLevel"] as const;
  for (const key of strings) if (typeof config[key] === "string" && config[key] !== "") out[key] = config[key];
  // Whole numbers the native SDKs can hold (Swift traps on a Double past Int's range), and an
  // upload interval of at least 1 second, the floor both native SDKs keep.
  const numbers = { flushIntervalMs: MIN_FLUSH_INTERVAL_MS, sessionTimeoutMs: 1, maxDiskBytes: 1 } as const;
  for (const key of Object.keys(numbers) as (keyof typeof numbers)[]) {
    const value = config[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[key] = Math.min(Math.max(Math.round(value), numbers[key]), Number.MAX_SAFE_INTEGER);
    }
  }
  const flags = ["captureCrashes", "attachScreen", "attest", "mirrorToNativeLog"] as const;
  for (const key of flags) if (typeof config[key] === "boolean") out[key] = config[key];
  if (Array.isArray(config.redactKeys)) out.redactKeys = config.redactKeys.filter((k) => typeof k === "string");
  return out;
}

function devWarn(message: string): void {
  if ((globalThis as { __DEV__?: boolean }).__DEV__) console.warn(`[lyrelog] ${message}`);
}
