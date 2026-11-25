/**
 * Which bundle an exception's frames are in, by debug id (as in `@lyrelog/js`). `withLyrelog`
 * (`@lyrelog/react-native/metro`) puts a snippet at the start of each release bundle that
 * registers the bundle's id under the stack of an Error made there:
 * `globalThis._lyrelogDebugIds[stack] = id`. That stack's first frame is the bundle's own URL,
 * so the registry reads as URL to id. Bundles injected by Sentry's tools register the same way
 * under `_sentryDebugIds`, and are read too.
 *
 * An exception then carries `debug_ids` (each URL in its stack that has one, to its id), and the
 * server reads its frames with the source maps uploaded for those ids.
 */

const REGISTRIES = ["_lyrelogDebugIds", "_sentryDebugIds"] as const;

/** At most this many bundles are named for one exception (the server reads 8). */
export const MAX_DEBUG_IDS = 8;

/** The URL of a stack frame line, as Hermes, JavaScriptCore and V8 print them; undefined if none. */
export function frameURL(line: string): string | undefined {
  let s = line.trim();
  if (s.endsWith(")")) {
    const open = s.lastIndexOf("(");
    if (open < 0) return undefined;
    s = s.slice(open + 1, -1);
  } else if (s.startsWith("at ")) {
    s = s.slice(3).replace(/^async /, "");
  } else {
    const at = s.indexOf("@");
    if (at < 0) return undefined;
    s = s.slice(at + 1);
  }
  // Hermes running bytecode: "address at index.android.bundle:1:9876".
  s = s.replace(/^address at /, "");
  const m = /^(.+):\d+:\d+$/.exec(s);
  return m ? m[1] : undefined;
}

let cachedCount = -1;
let cachedClean: ((stack: string) => string) | undefined;
let cached = new Map<string, string>();

function registry(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const g = globalThis as Record<string, unknown>;
  for (const name of REGISTRIES) {
    try {
      const r = g[name];
      if (typeof r === "object" && r !== null) out.push(r as Record<string, unknown>);
    } catch {
      // a getter that throws
    }
  }
  return out;
}

/**
 * The registry as URL to id, URLs cleaned as the stacks are (`clean`). Read again only when
 * bundles were added (a lazily loaded chunk registers when it loads).
 */
export function debugIdsByURL(clean: (stack: string) => string): Map<string, string> {
  const registries = registry();
  let count = 0;
  for (const r of registries) count += Object.keys(r).length;
  if (count === cachedCount && clean === cachedClean) return cached;
  const next = new Map<string, string>();
  for (const r of registries) {
    for (const [stack, id] of Object.entries(r)) {
      if (typeof id !== "string") continue;
      for (const line of stack.split("\n")) {
        const url = frameURL(line);
        if (url !== undefined) {
          next.set(clean(url), id);
          break;
        }
      }
    }
  }
  cached = next;
  cachedCount = count;
  cachedClean = clean;
  return next;
}

/** The debug ids of the bundles in these stacks, or undefined when none has one. */
export function debugIdsOf(stacks: string[], clean: (stack: string) => string): Record<string, string> | undefined {
  const byURL = debugIdsByURL(clean);
  if (byURL.size === 0) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const stack of stacks) {
    for (const line of stack.split("\n")) {
      const url = frameURL(line);
      if (url === undefined || url in out) continue;
      const id = byURL.get(url);
      if (id === undefined) continue;
      out[url] = id;
      if (++n === MAX_DEBUG_IDS) return out;
    }
  }
  return n > 0 ? out : undefined;
}
