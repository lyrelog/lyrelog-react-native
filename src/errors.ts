// JavaScript errors: how one is described (the `exception` and `app_crashed` events share it)
// and the hooks that see the ones nobody caught.
import { debugIdsOf } from "./debug-ids";
import { cut, errorFields, toPlain, type Plain } from "./values";

export interface Described {
  /** `error_type`: the error's name (`TypeError`), or `typeof` for a thrown non-error. */
  type: string;
  /** `error_message`. */
  message: string;
  /** The payload: name, message, stack, code, cause (3 deep), component stack. */
  payload: { [key: string]: Plain };
}

export function isError(value: unknown): value is Error {
  if (value instanceof Error) return true;
  try {
    return Object.prototype.toString.call(value) === "[object Error]";
  } catch {
    return false;
  }
}

/** Like `@lyrelog/js`: the same attributes and payload shape, so both read the same on the dashboard. */
export function describe(error: unknown, componentStack?: string | null): Described {
  let type: string = typeof error;
  let message: string;
  if (isError(error)) {
    type = safeString(() => error.name) || safeString(() => error.constructor?.name) || "Error";
    message = safeString(() => error.message);
  } else if (typeof error === "object" && error !== null) {
    const fields = errorFields(error);
    if (typeof fields.name === "string" && fields.name) type = fields.name;
    message = typeof fields.message === "string" ? fields.message : safeString(() => Object.prototype.toString.call(error));
  } else {
    message = safeString(() => String(error));
  }
  const payload = describePayload(error, 0);
  // The bundles the stacks are in, by the debug ids `withLyrelog` gave them: the server reads the
  // frames with their source maps.
  const stacks: string[] = [];
  for (let e: unknown = payload; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const stack = (e as { stack?: unknown }).stack;
    if (typeof stack === "string") stacks.push(stack);
  }
  try {
    const ids = debugIdsOf(stacks, (s) => s);
    if (ids !== undefined) payload.debug_ids = ids;
  } catch {
    // never into the app
  }
  if (componentStack) payload.component_stack = toPlain(componentStack);
  return { type: cut(type), message: cut(message), payload };
}

function describePayload(error: unknown, depth: number): { [key: string]: Plain } {
  if (!isError(error)) {
    if (typeof error === "object" && error !== null) return errorFields(error);
    return { value: toPlain(safeString(() => String(error))) };
  }
  const out: { [key: string]: Plain } = errorFields(error);
  const stack = safeString(() => error.stack);
  if (stack) out.stack = toPlain(stack);
  const cause = read(error, "cause");
  if (cause !== undefined && depth < 3) out.cause = describePayload(cause, depth + 1);
  return out;
}

function read(object: object, key: string): unknown {
  try {
    return (object as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeString(get: () => unknown): string {
  try {
    const value = get();
    return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  } catch {
    return "";
  }
}

/** Type, message and the first frame: what makes two uncaught errors the same one. */
export function fingerprint(error: unknown): string {
  if (!isError(error)) return `${typeof error}|${safeString(() => String(error))}`;
  const frames = safeString(() => error.stack).split("\n").slice(1);
  const top = frames.find((line) => /^\s*at\s|@/.test(line))?.trim() ?? "";
  return `${safeString(() => error.name)}|${safeString(() => error.message)}|${top}`;
}

/** Uncaught errors recorded at most 10 a minute, the same one once per 10 s (as in `@lyrelog/js`). */
export const UNCAUGHT_PER_MINUTE = 10;
export const UNCAUGHT_REPEAT_MS = 10_000;

export class FloodGuard {
  private times: number[] = [];
  private seen = new Map<string, number>();
  skipped = 0;

  constructor(private readonly now: () => number = Date.now) {}

  admit(error: unknown): boolean {
    const now = this.now();
    this.times = this.times.filter((t) => now - t < 60_000);
    for (const [key, at] of this.seen) if (now - at >= UNCAUGHT_REPEAT_MS) this.seen.delete(key);
    const key = fingerprint(error);
    if (this.seen.has(key) || this.times.length >= UNCAUGHT_PER_MINUTE) {
      this.skipped += 1;
      return false;
    }
    this.seen.set(key, now);
    this.times.push(now);
    return true;
  }
}

/** How an uncaught error reached us; sent as `mechanism`. */
export type Mechanism = "js_fatal" | "js_error" | "react_render" | "unhandled_rejection";

export type UncaughtReporter = (error: unknown, fatal: boolean, mechanism: Mechanism, componentStack?: string | null) => void;

interface ErrorUtilsLike {
  getGlobalHandler(): ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

interface ExceptionsManagerLike {
  handleException(error: unknown, isFatal: boolean): void;
}

interface RejectionTrackerOptions {
  allRejections: boolean;
  onUnhandled: (id: number, rejection: unknown) => void;
  onHandled: (id: number) => void;
}

interface HermesLike {
  enablePromiseRejectionTracker?: (options: RejectionTrackerOptions) => void;
}

/** What the hooks reach; `install` finds them in React Native, the tests pass fakes. */
export interface Hooks {
  errorUtils?: ErrorUtilsLike;
  exceptionsManager?: ExceptionsManagerLike;
  hermes?: HermesLike;
  /** React Native's own rejection options (dev builds only: they show the warning in LogBox). */
  devRejectionOptions?: Partial<RejectionTrackerOptions>;
}

export function reactNativeHooks(): Hooks {
  const g = globalThis as unknown as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike; __DEV__?: boolean };
  const hooks: Hooks = { errorUtils: g.ErrorUtils, hermes: g.HermesInternal };
  try {
    // React reports render errors no boundary caught straight to the ExceptionsManager, never
    // through ErrorUtils. A deep import, guarded: if it moves, only that path is missed.
    hooks.exceptionsManager = require("react-native/Libraries/Core/ExceptionsManager").default;
  } catch {
    // not there in this version
  }
  if (g.__DEV__) {
    try {
      hooks.devRejectionOptions = require("react-native/Libraries/promiseRejectionTrackingOptions").default;
    } catch {
      // not there in this version
    }
  }
  return hooks;
}

/**
 * Installs the hooks once per JavaScript runtime (a second `init`, a fast refresh, keep the first
 * ones, which call whatever reporter was set last). Every hook calls what was there before, so
 * React Native's red box, a release build's crash, and any other tool still see the error.
 */
export function installErrorHooks(hooks: Hooks, report: UncaughtReporter): void {
  const state = hookState();
  state.report = report;
  if (state.installed) return;
  state.installed = true;

  // Each error once, though it may pass through ErrorUtils and then the ExceptionsManager.
  const recorded = new WeakSet<object>();
  let lastPrimitive: unknown = undefined;
  const once = (error: unknown): boolean => {
    if (typeof error === "object" && error !== null) {
      if (recorded.has(error)) return false;
      recorded.add(error);
      return true;
    }
    if (error === lastPrimitive && error !== undefined) return false;
    lastPrimitive = error;
    return true;
  };
  const send: UncaughtReporter = (error, fatal, mechanism, componentStack) => {
    try {
      if (once(error)) state.report?.(error, fatal, mechanism, componentStack);
    } catch {
      // never throws into the app
    }
  };

  const errorUtils = hooks.errorUtils;
  if (errorUtils && typeof errorUtils.setGlobalHandler === "function") {
    try {
      const previous = errorUtils.getGlobalHandler?.();
      errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        send(error, isFatal === true, isFatal === true ? "js_fatal" : "js_error");
        previous?.(error, isFatal);
      });
    } catch {
      // leave it as it was
    }
  }

  const hermes = hooks.hermes;
  const trackingRejections = !!hermes && typeof hermes.enablePromiseRejectionTracker === "function";

  const manager = hooks.exceptionsManager;
  if (manager && typeof manager.handleException === "function") {
    try {
      const original = manager.handleException;
      manager.handleException = function (this: unknown, error: unknown, isFatal: boolean) {
        const component = componentOf(error);
        if (component.isComponentError) {
          // Caught by a boundary (not fatal): the app handled it, and ours records it itself.
          if (isFatal) send(error, true, "react_render", component.stack);
        } else if (!(trackingRejections && isRejectionReport(error))) {
          send(error, isFatal === true, isFatal === true ? "js_fatal" : "js_error");
        }
        return original.call(this, error, isFatal);
      };
    } catch {
      // leave it as it was
    }
  }

  if (trackingRejections) {
    try {
      const dev = hooks.devRejectionOptions;
      hermes!.enablePromiseRejectionTracker!({
        allRejections: true,
        onUnhandled: (id, rejection) => {
          send(rejection, false, "unhandled_rejection");
          dev?.onUnhandled?.(id, rejection);
        },
        onHandled: (id) => {
          dev?.onHandled?.(id);
        },
      });
    } catch {
      // leave it as it was
    }
  }
}

function componentOf(error: unknown): { isComponentError: boolean; stack?: string } {
  if (typeof error !== "object" || error === null) return { isComponentError: false };
  const flagged = read(error, "isComponentError") === true;
  const stack = read(error, "componentStack");
  return { isComponentError: flagged, stack: typeof stack === "string" ? stack : undefined };
}

/** React Native's dev tracker reports a rejection we already recorded as `new Error("Uncaught (in promise...")`. */
function isRejectionReport(error: unknown): boolean {
  return isError(error) && safeString(() => error.message).startsWith("Uncaught (in promise");
}

interface HookState {
  installed: boolean;
  report?: UncaughtReporter;
}

function hookState(): HookState {
  const g = globalThis as unknown as { __lyrelogErrorHooks?: HookState };
  g.__lyrelogErrorHooks ??= { installed: false };
  return g.__lyrelogErrorHooks;
}

/** @internal For the tests: forget that the hooks were installed. */
export function resetErrorHooksForTests(): void {
  (globalThis as unknown as { __lyrelogErrorHooks?: HookState }).__lyrelogErrorHooks = undefined;
}
