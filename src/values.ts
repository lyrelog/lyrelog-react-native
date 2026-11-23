// Turns anything the app passes into plain JSON before it crosses to the native SDK. The native
// side does the real work (redaction, the server's limits); this only makes sure the crossing
// can't loop on a cycle, choke on a huge object or throw on a getter.

/** Longest string carried across. The native SDKs cut attrs to 1,024 bytes and summarise payloads over 64 KiB. */
export const MAX_STRING = 64 * 1024;
/** Values visited per call; past it the rest is left out. */
export const MAX_NODES = 5000;
/** Nesting kept; deeper values become "[depth]". The native SDKs keep attrs to 4 levels. */
export const MAX_DEPTH = 24;
/** Items kept from one array. */
export const MAX_ITEMS = 1000;
/**
 * Characters of strings and keys carried by one call. The native SDKs keep 64 KiB of a payload
 * (a bigger one becomes a summary of its first 1 KiB), so past this nothing more would be kept.
 */
export const MAX_CHARS = 128 * 1024;

export type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };

interface Walk {
  nodes: number;
  chars: number;
  seen: Set<object>;
}

/** A JSON-safe copy: no cycles, no functions, no `undefined`, bounded in size. Never throws. */
export function toPlain(value: unknown): Plain {
  try {
    return convert(value, { nodes: 0, chars: 0, seen: new Set() }, 0);
  } catch {
    return null;
  }
}

/** `toPlain` for attrs: always an object (or null when there is nothing). */
export function toPlainObject(value: unknown): { [key: string]: Plain } | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return null;
  const plain = toPlain(value);
  if (plain === null || typeof plain !== "object" || Array.isArray(plain)) return null;
  return Object.keys(plain).length > 0 ? plain : null;
}

function convert(value: unknown, walk: Walk, depth: number): Plain {
  walk.nodes += 1;
  if (walk.nodes > MAX_NODES) return "[truncated]";
  switch (typeof value) {
    case "string":
      return take(value, walk);
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return null;
  }
  if (value === null) return null;
  const object = value as object;
  if (walk.seen.has(object)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[depth]";
  if (object instanceof Date) return Number.isNaN(object.getTime()) ? null : object.toISOString();
  if (object instanceof Error) return errorFields(object);
  walk.seen.add(object);
  try {
    if (Array.isArray(object)) {
      const out: Plain[] = [];
      const n = Math.min(object.length, MAX_ITEMS);
      for (let i = 0; i < n; i++) {
        if (walk.chars >= MAX_CHARS) {
          out.push("[truncated]");
          break;
        }
        out.push(convert(read(object, i), walk, depth + 1));
      }
      return out;
    }
    if (object instanceof Map) {
      const out: { [key: string]: Plain } = {};
      for (const [k, v] of object) {
        if (walk.nodes > MAX_NODES || walk.chars >= MAX_CHARS) break;
        out[take(String(k), walk)] = convert(v, walk, depth + 1);
      }
      return out;
    }
    // Only the first items: never a copy of a whole set or typed array (Object.keys of a
    // 10 MB Uint8Array would make ten million strings).
    if (object instanceof Set || (ArrayBuffer.isView(object) && !(object instanceof DataView))) {
      const out: Plain[] = [];
      for (const item of object as Iterable<unknown>) {
        if (out.length >= MAX_ITEMS) break;
        out.push(convert(item, walk, depth + 1));
      }
      return out;
    }
    const toJSON = read(object, "toJSON");
    if (typeof toJSON === "function") {
      let replaced: unknown;
      try {
        replaced = toJSON.call(object);
      } catch {
        return null;
      }
      if (replaced !== object) return convert(replaced, walk, depth);
    }
    const out: { [key: string]: Plain } = {};
    for (const key of Object.keys(object)) {
      if (walk.nodes > MAX_NODES || walk.chars >= MAX_CHARS) break;
      const field = read(object, key);
      if (field === undefined || typeof field === "function" || typeof field === "symbol") continue;
      out[take(key, walk)] = convert(field, walk, depth + 1);
    }
    return out;
  } finally {
    walk.seen.delete(object);
  }
}

function read(object: object, key: string | number): unknown {
  try {
    return (object as Record<string | number, unknown>)[key];
  } catch {
    return undefined; // a getter that throws
  }
}

/** `cut`, within what is left of the call's characters. */
function take(text: string, walk: Walk): string {
  const left = MAX_CHARS - walk.chars;
  if (left <= 0) return "[truncated]";
  const kept = cut(text, Math.min(MAX_STRING, left));
  walk.chars += kept.length;
  return kept;
}

/** At most `max` UTF-16 units (`MAX_STRING` by default), never splitting a surrogate pair. */
export function cut(text: string, max: number = MAX_STRING): string {
  if (text.length <= max) return text;
  let end = max;
  // Never split a surrogate pair.
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** What names an error, never the rest of it (a request error would carry its headers). */
export function errorFields(error: unknown): { [key: string]: Plain } {
  const out: { [key: string]: Plain } = {};
  if (error === null || typeof error !== "object") return { message: cut(String(error)) };
  for (const key of ["name", "message", "code", "status"]) {
    const field = read(error, key);
    if (typeof field === "string") out[key] = cut(field);
    else if ((typeof field === "number" && Number.isFinite(field)) || typeof field === "boolean") out[key] = field;
  }
  return out;
}
