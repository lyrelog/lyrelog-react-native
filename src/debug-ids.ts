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

/**
 * The URL of a stack frame line, as Hermes, JavaScriptCore and V8 print them; undefined if none. Read as
 * the server reads it: a V8 frame's location is after the first " (" (a URL may hold parentheses
 * itself: Next.js's route groups, `app/(shop)/page.js`).
 */
export function frameURL(line: string): string | undefined {
  const s = line.trim();
  // Hermes running bytecode: "address at index.android.bundle:1:9876".
  let loc: string;
  if (s.startsWith("at ")) {
    const rest = s.slice(3).replace(/^async /, "");
    const open = rest.indexOf(" (");
    loc = open >= 0 && rest.endsWith(")") ? rest.slice(open + 2, -1) : rest;
  } else {
    const at = s.indexOf("@");
    if (at < 0) return undefined;
    loc = s.slice(at + 1);
  }
  loc = loc.replace(/^address at /, "");
  const m = /^(.+):\d+:\d+$/.exec(loc);
  return m ? m[1] : undefined;
}

/** The registries read as bundle URL (as their stacks print it) to id, kept until one changes. */
let cachedSignature = "";
let cachedRaw = new Map<string, string>();

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
 * The registry as URL to id, URLs cleaned as the stacks are (`clean`). The registries are read
 * again only when one changes (a lazily loaded chunk registers when it loads, a bundle loaded
 * again can bring another id). A bundle Lyrelog gave an id keeps Lyrelog's when Sentry's tools
 * gave it one too: Lyrelog's maps are uploaded under Lyrelog's.
 */
export function debugIdsByURL(clean: (stack: string) => string): Map<string, string> {
  const registries = registry();
  let signature = "";
  for (const r of registries) {
    for (const [stack, id] of Object.entries(r)) signature += `${stack.length}:${String(id)};`;
    signature += "|";
  }
  if (signature !== cachedSignature) {
    const next = new Map<string, string>();
    for (const r of registries) {
      for (const [stack, id] of Object.entries(r)) {
        if (typeof id !== "string") continue;
        for (const line of stack.split("\n")) {
          const url = frameURL(line);
          if (url !== undefined) {
            if (!next.has(url)) next.set(url, id);
            break;
          }
        }
      }
    }
    cachedRaw = next;
    cachedSignature = signature;
  }
  const out = new Map<string, string>();
  for (const [url, id] of cachedRaw) {
    const cleaned = clean(url);
    if (!out.has(cleaned)) out.set(cleaned, id);
  }
  return out;
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
