import type { Spec } from "../NativeLyrelog";

export interface Call {
  method: string;
  args: unknown[];
}

/** A native module that records what it's told. */
export function fakeNative(): Spec & { calls: Call[]; named(method: string): Call[] } {
  const calls: Call[] = [];
  const record =
    (method: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };
  return {
    calls,
    named: (method: string) => calls.filter((c) => c.method === method),
    start: record("start"),
    log: record("log"),
    logNow: record("logNow", true) as Spec["logNow"],
    setUser: record("setUser"),
    setConsent: record("setConsent"),
    screen: record("screen"),
    flush: record("flush", Promise.resolve()) as Spec["flush"],
    stop: record("stop", Promise.resolve()) as Spec["stop"],
    getSessionId: record("getSessionId", "8c1b6f0e-0000-4000-8000-000000000000") as Spec["getSessionId"],
    getConstants: () => ({}),
  } as unknown as Spec & { calls: Call[]; named(method: string): Call[] };
}

type Handler = (error: unknown, isFatal?: boolean) => void;

/** React Native's ErrorUtils, ExceptionsManager and Hermes tracker, as far as the hooks use them. */
export function fakeHooks() {
  const seen: { previous: unknown[]; manager: unknown[]; devUnhandled: unknown[] } = { previous: [], manager: [], devUnhandled: [] };
  let handler: Handler = (error, isFatal) => seen.previous.push([error, isFatal]);
  let tracker: { onUnhandled: (id: number, r: unknown) => void; onHandled: (id: number) => void } | undefined;
  const exceptionsManager = {
    handleException(error: unknown, isFatal: boolean) {
      seen.manager.push([error, isFatal]);
    },
  };
  const hooks = {
    errorUtils: {
      getGlobalHandler: () => handler,
      setGlobalHandler: (h: Handler) => {
        handler = h;
      },
    },
    exceptionsManager,
    hermes: {
      enablePromiseRejectionTracker: (options: typeof tracker) => {
        tracker = options;
      },
    },
    devRejectionOptions: {
      onUnhandled: (_id: number, rejection: unknown) => {
        seen.devUnhandled.push(rejection);
        // What React Native's dev options do with it.
        exceptionsManager.handleException(new Error(`Uncaught (in promise, id: ${_id})`, { cause: rejection }), false);
      },
    },
  };
  return {
    hooks,
    seen,
    /** As React Native calls the global handler. */
    throwUncaught: (error: unknown, isFatal: boolean) => handler(error, isFatal),
    /** As Hermes reports an unhandled rejection. */
    reject: (id: number, reason: unknown) => tracker?.onUnhandled(id, reason),
  };
}
