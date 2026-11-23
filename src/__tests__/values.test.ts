import { MAX_CHARS, MAX_ITEMS, MAX_NODES, MAX_STRING, toPlain, toPlainObject } from "../values";

describe("toPlain", () => {
  it("keeps JSON as it is", () => {
    const value = { a: 1, b: "x", c: true, d: null, e: [1, "two", { f: 2.5 }] };
    expect(toPlain(value)).toEqual(value);
  });

  it("drops what JSON can't hold", () => {
    expect(toPlain({ a: undefined, b: () => 1, c: Symbol("s"), d: 1 })).toEqual({ d: 1 });
    expect(toPlain([undefined, () => 1])).toEqual([null, null]);
    expect(toPlain(NaN)).toBeNull();
    expect(toPlain(Infinity)).toBeNull();
  });

  it("turns other values into strings or objects", () => {
    expect(toPlain(10n)).toBe("10");
    expect(toPlain(new Date("2026-11-20T10:00:00Z"))).toBe("2026-11-20T10:00:00.000Z");
    expect(toPlain(new Date("nope"))).toBeNull();
    expect(toPlain(new Map([["k", 1]]))).toEqual({ k: 1 });
    expect(toPlain(new Set([1, 2]))).toEqual([1, 2]);
    expect(toPlain({ toJSON: () => "custom" })).toBe("custom");
  });

  it("keeps only what names an error", () => {
    const error = Object.assign(new TypeError("bad"), { code: "E1", headers: { cookie: "x" } });
    expect(toPlain({ e: error })).toEqual({ e: { name: "TypeError", message: "bad", code: "E1" } });
  });

  it("never loops on a cycle", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(toPlain(a)).toEqual({ name: "a", self: "[circular]" });
  });

  it("keeps a shared value that isn't a cycle", () => {
    const shared = { x: 1 };
    expect(toPlain({ a: shared, b: shared })).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });

  it("survives a getter that throws", () => {
    const value = {
      ok: 1,
      get bad(): number {
        throw new Error("no");
      },
    };
    expect(toPlain(value)).toEqual({ ok: 1 });
  });

  it("bounds strings, arrays and the number of values", () => {
    expect((toPlain("x".repeat(MAX_STRING + 10)) as string).length).toBe(MAX_STRING);
    expect((toPlain(new Array(MAX_ITEMS + 5).fill(0)) as unknown[]).length).toBe(MAX_ITEMS);
    const wide = Object.fromEntries(Array.from({ length: MAX_NODES * 2 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(toPlain(wide) as object).length).toBeLessThanOrEqual(MAX_NODES);
  });

  it("bounds what one call carries across, however many strings it holds", () => {
    // 1,000 strings of 100 KB: 64 MiB to the native side before; the native SDK keeps 64 KiB of a payload.
    const plain = toPlain(Array.from({ length: 1000 }, () => "x".repeat(100_000)));
    expect(JSON.stringify(plain).length).toBeLessThanOrEqual(MAX_CHARS + 10_000);
    const keys = toPlain(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`${i}`.padEnd(50_000, "k"), 1])));
    expect(JSON.stringify(keys).length).toBeLessThanOrEqual(MAX_CHARS + 10_000);
  });

  it("reads only the first items of a typed array or a set", () => {
    const bytes = toPlain(new Uint8Array(2_000_000));
    expect(Array.isArray(bytes) && bytes.length).toBe(MAX_ITEMS);
    let pulled = 0;
    const big = new Set(Array.from({ length: 50_000 }, (_, i) => i));
    const iterate = big[Symbol.iterator].bind(big);
    big[Symbol.iterator] = function* () {
      for (const v of iterate()) {
        pulled += 1;
        yield v;
      }
    } as typeof big[typeof Symbol.iterator];
    expect((toPlain(big) as unknown[]).length).toBe(MAX_ITEMS);
    expect(pulled).toBeLessThanOrEqual(MAX_ITEMS + 1);
  });

  it("never splits a surrogate pair", () => {
    const text = "a".repeat(MAX_STRING - 1) + "😀";
    const cut = toPlain(text) as string;
    expect(cut.length).toBe(MAX_STRING - 1);
  });

  it("gives attrs as an object or nothing", () => {
    expect(toPlainObject(undefined)).toBeNull();
    expect(toPlainObject([1])).toBeNull();
    expect(toPlainObject({})).toBeNull();
    expect(toPlainObject({ a: 1 })).toEqual({ a: 1 });
  });
});
