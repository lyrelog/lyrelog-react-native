import { DEFAULT_REDACT_KEYS, FATAL_WAIT_MS, LyrelogClient, MIN_FLUSH_INTERVAL_MS, nativeConfig } from "../client";
import { resetErrorHooksForTests } from "../errors";
import { MAX_STRING } from "../values";
import { fakeHooks, fakeNative } from "./fakes";

function started(config: Parameters<LyrelogClient["init"]>[0] = { apiKey: "lyr_ing_test" }) {
  resetErrorHooksForTests();
  const native = fakeNative();
  const fake = fakeHooks();
  const client = new LyrelogClient(native, () => fake.hooks).init(config);
  return { client, native, fake };
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("init", () => {
  it("starts the native SDK once, with only what was set", () => {
    const { client, native } = started({ apiKey: "lyr_ing_test", endpoint: "http://127.0.0.1:8090", flushIntervalMs: 5000, attest: false });
    client.init({ apiKey: "lyr_ing_other" });
    expect(native.named("start")).toHaveLength(1);
    expect(native.named("start")[0].args[0]).toEqual({ apiKey: "lyr_ing_test", endpoint: "http://127.0.0.1:8090", flushIntervalMs: 5000, attest: false });
  });

  it("refuses a missing key", () => {
    resetErrorHooksForTests();
    const native = fakeNative();
    new LyrelogClient(native, () => fakeHooks().hooks).init({ apiKey: "" });
    expect(native.named("start")).toHaveLength(0);
  });

  it("drops bad values from the native config", () => {
    expect(nativeConfig({ apiKey: "k", flushIntervalMs: -1, sessionTimeoutMs: NaN, environment: "", redactKeys: ["pin", 3 as unknown as string] })).toEqual({
      apiKey: "k",
      redactKeys: ["pin"],
    });
  });

  it("keeps numbers the native SDKs can hold", () => {
    // Swift traps converting 1e300 to Int.
    const out = nativeConfig({ apiKey: "k", flushIntervalMs: 0.4, sessionTimeoutMs: 1e300, maxDiskBytes: 1e300 });
    expect(out.flushIntervalMs).toBe(MIN_FLUSH_INTERVAL_MS);
    expect(out.sessionTimeoutMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(out.maxDiskBytes).toBe(Number.MAX_SAFE_INTEGER);
    expect(nativeConfig({ apiKey: "k", flushIntervalMs: 2500.6, maxDiskBytes: 0.2 })).toEqual({ apiKey: "k", flushIntervalMs: 2501, maxDiskBytes: 1 });
  });

  it("raises an upload interval under 1 second to 1 second, as the native SDKs do", () => {
    expect(MIN_FLUSH_INTERVAL_MS).toBe(1000);
    expect(nativeConfig({ apiKey: "k", flushIntervalMs: 100 }).flushIntervalMs).toBe(1000);
    expect(nativeConfig({ apiKey: "k", flushIntervalMs: 999 }).flushIntervalMs).toBe(1000);
    expect(nativeConfig({ apiKey: "k", flushIntervalMs: 1000 }).flushIntervalMs).toBe(1000);
  });

  it("exports the default redaction list, frozen", () => {
    expect(DEFAULT_REDACT_KEYS).toContain("authorization");
    expect(Object.isFrozen(DEFAULT_REDACT_KEYS)).toBe(true);
  });

  it("works without the native module, quietly", () => {
    const client = new LyrelogClient(null, () => ({}));
    expect(() => client.init({ apiKey: "k" }).info("x")).not.toThrow();
    expect(client.sessionId).toBeUndefined();
  });
});

describe("logging", () => {
  it("sends level, message, category, attrs and the payload wrapped", () => {
    const { client, native } = started();
    client.info("checkout_done", { category: "checkout", attrs: { items: 3 }, payload: ["a", 1] });
    expect(native.named("log")[0].args).toEqual(["info", "checkout_done", "checkout", { items: 3 }, { value: ["a", 1] }]);
  });

  it("sends nulls for what's left out", () => {
    const { client, native } = started();
    client.warning("w");
    expect(native.named("log")[0].args).toEqual(["warning", "w", null, null, null]);
  });

  it("drops events below the minimum level before crossing", () => {
    const { client, native } = started({ apiKey: "k", minimumLevel: "warning" });
    client.info("quiet");
    client.error("loud");
    expect(native.named("log").map((c) => c.args[1])).toEqual(["loud"]);
  });

  it("drops trace by default (minimum debug)", () => {
    const { client, native } = started();
    client.trace("t");
    client.debug("d");
    expect(native.named("log").map((c) => c.args[1])).toEqual(["d"]);
  });

  it("ignores events before init, like the native SDKs", () => {
    const native = fakeNative();
    const client = new LyrelogClient(native, () => ({}));
    client.info("early");
    expect(native.named("log")).toHaveLength(0);
  });

  it("gives each area its own logger", () => {
    const { client, native } = started();
    const store = client.logger("store");
    store.warning("purchase_retry", { attrs: { attempt: 2 } });
    store.captureError(new Error("x"));
    store.captureException(new Error("y"));
    expect(native.named("log").map((c) => [c.args[1], c.args[2]])).toEqual([
      ["purchase_retry", "store"],
      ["exception", "store"],
      ["exception", "store"],
    ]);
  });

  it("never throws, even when the native call does", () => {
    const { client, native } = started();
    native.log = () => {
      throw new Error("boom");
    };
    expect(() => client.info("x")).not.toThrow();
  });
});

describe("user, consent, screens", () => {
  it("passes them through, cleaning what isn't valid", () => {
    const { client, native } = started();
    client.setUser("u_1");
    client.setUser("");
    client.setUser(undefined);
    client.setConsent("pending");
    client.setConsent("maybe" as never);
    client.screen("Settings", { tab: "privacy" });
    client.screen("");
    expect(native.named("setUser").map((c) => c.args[0])).toEqual(["u_1", null, null]);
    expect(native.named("setConsent").map((c) => c.args[0])).toEqual(["pending"]);
    expect(native.named("screen").map((c) => c.args)).toEqual([["Settings", { tab: "privacy" }]]);
  });

  it("sends a numeric user id as its text instead of clearing the user", () => {
    const { client, native } = started();
    client.setUser(12345);
    client.setUser(0);
    client.setUser(BigInt("12345678901234567890") as unknown as number);
    client.setUser(NaN);
    client.setUser(null);
    expect(native.named("setUser").map((c) => c.args[0])).toEqual(["12345", "0", "12345678901234567890", null, null]);
  });

  it("lets user and consent through before init (the native SDKs keep them)", () => {
    const native = fakeNative();
    const client = new LyrelogClient(native, () => ({}));
    client.setUser("u_1");
    client.setConsent("denied");
    expect(native.named("setUser")).toHaveLength(1);
    expect(native.named("setConsent")).toHaveLength(1);
  });

  it("reads the session id from the native SDK", () => {
    const { client } = started();
    expect(client.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("flushes and closes", async () => {
    const { client, native } = started();
    await client.flush();
    await client.close();
    await client.flush();
    expect(native.calls.filter((c) => c.method === "flush" || c.method === "stop").map((c) => c.method)).toEqual(["flush", "stop"]);
  });
});

describe("sizes", () => {
  it("cuts a huge message and error message before they cross", () => {
    const { client, native } = started();
    client.info("m".repeat(1_000_000));
    client.captureError(Object.assign(new Error("e".repeat(1_000_000)), { name: "N".repeat(1_000_000) }));
    const [log, exception] = native.named("log");
    expect((log.args[1] as string).length).toBe(MAX_STRING);
    const attrs = exception.args[3] as { error_type: string; error_message: string };
    expect(attrs.error_message.length).toBe(MAX_STRING);
    expect(attrs.error_type.length).toBe(MAX_STRING);
  });
});

describe("flush", () => {
  it("runs one native flush at a time, and one more for the calls that came during it", async () => {
    const { client, native } = started();
    const pending: (() => void)[] = [];
    native.flush = jest.fn(() => new Promise<void>((resolve) => pending.push(resolve)));
    const all = Promise.all(Array.from({ length: 50 }, () => client.flush()));
    expect(native.flush).toHaveBeenCalledTimes(1);
    pending.shift()!();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(native.flush).toHaveBeenCalledTimes(2);
    pending.shift()!();
    await all;
    expect(native.flush).toHaveBeenCalledTimes(2);
    const later = client.flush();
    expect(native.flush).toHaveBeenCalledTimes(3);
    pending.shift()!();
    await later;
  });
});

describe("captureError", () => {
  it("sends the exception event every SDK sends", () => {
    const { client, native } = started();
    const error = new TypeError("undefined is not a function");
    client.captureError(error, { category: "sync", attrs: { attempt: 1, error_type: "mine" } });
    const [level, message, category, attrs, payload] = native.named("log")[0].args as [string, string, string, Record<string, unknown>, { value: Record<string, unknown> }];
    expect([level, message, category]).toEqual(["error", "exception", "sync"]);
    expect(attrs).toEqual({ attempt: 1, error_type: "TypeError", error_message: "undefined is not a function" });
    expect(payload.value.name).toBe("TypeError");
    expect(payload.value.stack).toContain("TypeError");
  });

  it("keeps causes, three deep", () => {
    const { client, native } = started();
    const root = new Error("root");
    const error = new Error("top", { cause: new Error("middle", { cause: root }) });
    client.captureError(error, { level: "warning" });
    const call = native.named("log")[0];
    expect(call.args[0]).toBe("warning");
    const payload = (call.args[4] as { value: { cause: { message: string; cause: { message: string } } } }).value;
    expect(payload.cause.message).toBe("middle");
    expect(payload.cause.cause.message).toBe("root");
  });

  it("keeps captureException as an alias of captureError", () => {
    const { client, native } = started();
    client.captureException(new RangeError("too far"), { category: "map", level: "warning" });
    client.captureError(new RangeError("too far"), { category: "map", level: "warning" });
    const [old, current] = native.named("log").map((c) => c.args.slice(0, 4));
    expect(old).toEqual(["warning", "exception", "map", { error_type: "RangeError", error_message: "too far" }]);
    expect(old).toEqual(current);
  });

  it("describes a thrown string or object without its other fields", () => {
    const { client, native } = started();
    client.captureError("plain text");
    client.captureError({ name: "HttpError", message: "503", status: 503, headers: { authorization: "x" } });
    const [first, second] = native.named("log").map((c) => [c.args[3], (c.args[4] as { value: unknown }).value]);
    expect(first).toEqual([{ error_type: "string", error_message: "plain text" }, { value: "plain text" }]);
    expect(second).toEqual([{ error_type: "HttpError", error_message: "503" }, { name: "HttpError", message: "503", status: 503 }]);
  });
});

describe("uncaught errors", () => {
  it("records a fatal error as app_crashed and waits for the disk, then calls the previous handler", () => {
    const { native, fake } = started();
    const error = new Error("render failed");
    fake.throwUncaught(error, true);
    const call = native.named("logNow")[0];
    expect(call.args.slice(0, 3)).toEqual(["critical", "app_crashed", "diagnostics"]);
    expect(call.args[3]).toEqual({ error_type: "Error", error_message: "render failed", handled: false, mechanism: "js_fatal" });
    expect(call.args[5]).toBe(FATAL_WAIT_MS);
    expect(fake.seen.previous).toEqual([[error, true]]);
  });

  it("records a non-fatal one as exception, handled false", () => {
    const { native, fake } = started();
    fake.throwUncaught(new Error("listener failed"), false);
    const call = native.named("log")[0];
    expect(call.args.slice(0, 3)).toEqual(["error", "exception", null]);
    expect(call.args[3]).toMatchObject({ handled: false, mechanism: "js_error" });
  });

  it("records an error once, though it passes through ErrorUtils and the ExceptionsManager", () => {
    const { native, fake } = started();
    const error = new Error("twice");
    fake.throwUncaught(error, true);
    fake.hooks.exceptionsManager.handleException(error, true);
    expect(native.named("logNow")).toHaveLength(1);
  });

  it("records a render error no boundary caught, with its component stack", () => {
    const { native, fake } = started();
    const error = Object.assign(new Error("bad render"), { isComponentError: true, componentStack: "\n    in Basket\n    in App" });
    fake.hooks.exceptionsManager.handleException(error, true);
    const call = native.named("logNow")[0];
    expect(call.args[3]).toMatchObject({ mechanism: "react_render" });
    expect((call.args[4] as { value: { component_stack: string } }).value.component_stack).toContain("in Basket");
    expect(fake.seen.manager).toHaveLength(1); // React Native still shows it
  });

  it("leaves errors a boundary caught to the boundary", () => {
    const { native, fake } = started();
    const error = Object.assign(new Error("caught"), { isComponentError: true });
    fake.hooks.exceptionsManager.handleException(error, false);
    expect(native.calls.filter((c) => c.method === "log" || c.method === "logNow")).toHaveLength(0);
  });

  it("records an unhandled rejection once, though React Native's dev tracker reports it again", () => {
    const { native, fake } = started();
    const reason = new Error("fetch failed");
    fake.reject(3, reason);
    expect(fake.seen.devUnhandled).toEqual([reason]);
    const logs = native.named("log");
    expect(logs).toHaveLength(1);
    expect(logs[0].args[3]).toMatchObject({ error_message: "fetch failed", handled: false, mechanism: "unhandled_rejection" });
  });

  it("holds back a flood of the same error", () => {
    const { client, native, fake } = started();
    for (let i = 0; i < 5; i++) fake.throwUncaught(new Error("same"), false);
    for (let i = 0; i < 20; i++) fake.throwUncaught(new Error(`different ${i}`), false);
    expect(native.named("log")).toHaveLength(10);
    expect(client.skippedErrors).toBe(15);
  });

  it("installs nothing with captureErrors off", () => {
    resetErrorHooksForTests();
    const native = fakeNative();
    const fake = fakeHooks();
    const before = fake.hooks.errorUtils.getGlobalHandler();
    new LyrelogClient(native, () => fake.hooks).init({ apiKey: "k", captureErrors: false });
    expect(fake.hooks.errorUtils.getGlobalHandler()).toBe(before);
  });

  it("still calls the previous handler when recording fails", () => {
    const { native, fake } = started();
    native.logNow = () => {
      throw new Error("native gone");
    };
    const error = new Error("x");
    expect(() => fake.throwUncaught(error, true)).not.toThrow();
    expect(fake.seen.previous).toEqual([[error, true]]);
  });
});
