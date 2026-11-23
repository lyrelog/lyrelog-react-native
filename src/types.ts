/** Severity, lowest first. Same names as every Lyrelog SDK and the ingest. */
export type Level = "trace" | "debug" | "info" | "notice" | "warning" | "error" | "critical";

export const LEVELS: readonly Level[] = ["trace", "debug", "info", "notice", "warning", "error", "critical"];

/**
 * `granted` sends, `pending` keeps events on the device unsent until you decide, `denied` deletes
 * what's queued and records nothing more.
 */
export type Consent = "granted" | "pending" | "denied";

/**
 * Small fields to filter and chart by: strings, numbers, booleans, null, arrays and nested objects
 * (up to 4 levels). Anything else is turned into one of those; nothing throws.
 */
export type Attributes = Record<string, unknown>;

export interface LogOptions {
  /** The area of the app (`checkout`, `sync`); the dashboard filters by it. */
  category?: string;
  attrs?: Attributes;
  /** Any JSON, for detail you only read when opening one event (up to 64 KiB serialized). */
  payload?: unknown;
}

export interface ExceptionOptions {
  category?: string;
  attrs?: Attributes;
  /** Defaults to `error`. */
  level?: Level;
  /** React's component stack, sent in the payload as `component_stack` (the error boundary passes it). */
  componentStack?: string | null;
}

export interface Config {
  /** The project's ingest key `lyr_ing_...`. Safe in the app: it can only append events. */
  apiKey: string;
  /**
   * The ingest. Default `https://ingest.lyrelog.com`. https only; plain http to `localhost`,
   * `127.0.0.1` and `::1` (the iOS simulator), and on the Android emulator to `10.0.2.2`.
   */
  endpoint?: string;
  /** Default `granted`. */
  consent?: Consent;
  /** `production`, `development`, `testflight` or any name. Detected by the native SDK when left out. */
  environment?: string;
  /** Which part of the product sends. Default: the OS (`ios`, `android`). */
  platform?: string;
  /** Events below this level are dropped before queueing. Default `debug`. */
  minimumLevel?: Level;
  /** How often queued events are sent while the app is in the foreground. Default 15000, at least 1000. */
  flushIntervalMs?: number;
  /** A new session starts after this long without an event. Default 30 minutes. */
  sessionTimeoutMs?: number;
  /** What may wait on the device; the oldest go first. Default 20 MB. */
  maxDiskBytes?: number;
  /**
   * The key names to redact. Left out, the defaults (`DEFAULT_REDACT_KEYS`). Your list replaces
   * them (extend them with `[...DEFAULT_REDACT_KEYS, "pin"]`); an empty list turns redaction off.
   */
  redactKeys?: readonly string[];
  /**
   * Record JavaScript errors nobody caught: a fatal one as `app_crashed`, the others and unhandled
   * promise rejections as `exception` with `handled: false`. Default true.
   */
  captureErrors?: boolean;
  /**
   * Native crashes: on Android uncaught JVM exceptions, on iOS MetricKit's crash and hang
   * reports. Sent on the next launch as `app_crashed`. Default true.
   */
  captureCrashes?: boolean;
  /** Tag every event with the screen set by `screen()` (`screen` attribute). Default true. */
  attachScreen?: boolean;
  /** Prove the app with App Attest (iOS) or Key Attestation (Android), so events are stored verified. Default true. */
  attest?: boolean;
  /** Also print every event to the device log (Xcode console / unified log, logcat tag `Lyrelog`). Default false. */
  mirrorToNativeLog?: boolean;
}

export interface LevelMethods<Options> {
  trace(message: string, options?: Options): void;
  debug(message: string, options?: Options): void;
  info(message: string, options?: Options): void;
  notice(message: string, options?: Options): void;
  warning(message: string, options?: Options): void;
  error(message: string, options?: Options): void;
  critical(message: string, options?: Options): void;
}

/** A logger for one area of the app: every event it records carries its `category`. */
export interface Logger extends LevelMethods<Omit<LogOptions, "category">> {
  readonly category: string;
  log(level: Level, message: string, options?: Omit<LogOptions, "category">): void;
  captureError(error: unknown, options?: Omit<ExceptionOptions, "category">): void;
  /** @deprecated Use `captureError`. */
  captureException(error: unknown, options?: Omit<ExceptionOptions, "category">): void;
}
