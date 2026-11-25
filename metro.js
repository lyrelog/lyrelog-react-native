'use strict';
/**
 * Readable JavaScript stacks in release builds (Lyrelog's source maps): `withLyrelog` gives each
 * production bundle Metro makes a debug id, before Hermes compiles it.
 *
 *   // metro.config.js
 *   const { withLyrelog } = require('@lyrelog/react-native/metro');
 *   module.exports = withLyrelog(mergeConfig(getDefaultConfig(__dirname), config));
 *
 * The bundle starts with a line that registers its id (`globalThis._lyrelogDebugIds`, read by the
 * SDK, which sends it with each error's stack), ends with `//# debugId=`, and its source map
 * carries `debugId`. That line is its own module, named after the id
 * (`__lyrelog_debug_id__<id>.js`): Hermes's composed source map keeps the names of the sources but
 * not `debugId`, so `lyrelog sourcemaps upload` finds the id there. The id comes from the
 * bundle's code, so the same code gets the same id.
 *
 * Left as they are: development bundles, a split bundle's modules (modulesOnly), and whatever a
 * serializer before this one makes that isn't one JavaScript bundle (Expo's static output). A
 * bundle another tool gave a debugId (Sentry's) keeps that one in its map and its comment; the
 * SDK and the CLI go by Lyrelog's own, in the registry and the module's name.
 */
const crypto = require('node:crypto');
const nodePath = require('node:path');

const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';
const MARKER = '__lyrelog_debug_id__';
const WRAPPED = Symbol.for('lyrelog.metro.serializer');

function snippet(id) {
  return (
    ';!function(){try{var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{},' +
    'n=(new e.Error).stack;n&&((e._lyrelogDebugIds=e._lyrelogDebugIds||{})[n]="' +
    id +
    '")}catch(e){}}();'
  );
}

/**
 * Metro's own serializer pieces, from the app's Metro (resolved from its project, so pnpm's
 * isolated installs and Yarn PnP find the one the app runs): `metro/private` from 0.83,
 * `metro/src` before.
 */
function metro(path, projectRoot) {
  const roots = [projectRoot, __dirname].filter(Boolean);
  for (const prefix of ['metro/private/', 'metro/src/']) {
    try {
      return require(require.resolve(prefix + path, { paths: roots }));
    } catch {
      // the other layout
    }
  }
  throw new Error(`@lyrelog/react-native/metro: Metro's ${path} wasn't found`);
}

function idOf(code) {
  const h = crypto.createHash('sha256').update(code).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** The snippet as a Metro script module, placed before every other. */
function debugIdModule(projectRoot) {
  const code = snippet(PLACEHOLDER);
  return {
    dependencies: new Map(),
    getSource: () => Buffer.from(code),
    inverseDependencies: new Set(),
    path: nodePath.join(projectRoot || process.cwd(), `${MARKER}${PLACEHOLDER}.js`),
    output: [{ type: 'js/script/virtual', data: { code, lineCount: 1, map: [[1, 0, 1, 0]], functionMap: null } }],
  };
}

function defaultBundle(entryPoint, preModules, graph, options) {
  const baseJSBundle = metro('DeltaBundler/Serializers/baseJSBundle', options.projectRoot).default;
  const bundleToString = metro('lib/bundleToString', options.projectRoot).default;
  return bundleToString(baseJSBundle(entryPoint, preModules, graph, options)).code;
}

function lyrelogSerializer(upstream) {
  const serialize = async (entryPoint, preModules, graph, options) => {
    const plain = () => (upstream ? upstream(entryPoint, preModules, graph, options) : defaultBundle(entryPoint, preModules, graph, options));
    if (options.dev || options.modulesOnly) return plain();
    const pre = [debugIdModule(options.projectRoot), ...preModules];
    const out = upstream ? await upstream(entryPoint, pre, graph, options) : defaultBundle(entryPoint, pre, graph, options);
    let code = typeof out === 'string' ? out : out && typeof out.code === 'string' ? out.code : undefined;
    // Not one JavaScript bundle with the snippet first (Expo's static output is a list of files):
    // made again without it, as it would have been.
    if (code === undefined || !code.includes(snippet(PLACEHOLDER))) return plain();
    let map = out && typeof out === 'object' && typeof out.map === 'string' ? out.map : undefined;
    if (map === undefined) {
      const { sourceMapString } = metro('DeltaBundler/Serializers/sourceMapString', options.projectRoot);
      const modules = [...graph.dependencies.values()].sort((a, b) => options.createModuleId(a.path) - options.createModuleId(b.path));
      map = sourceMapString([...pre, ...modules], {
        excludeSource: false,
        processModuleFilter: options.processModuleFilter,
        shouldAddToIgnoreList: options.shouldAddToIgnoreList,
        getSourceUrl: options.getSourceUrl,
      });
    }
    const id = idOf(code);
    // Only the snippet and its module's name change: the id has the placeholder's length, so the
    // map's columns stay right, and the same text anywhere else in the app stays as it was.
    code = code.replace(snippet(PLACEHOLDER), snippet(id));
    if (!/^\/\/# debugId=/m.test(code)) code += `\n//# debugId=${id}\n`;
    const parsed = JSON.parse(map.split(`${MARKER}${PLACEHOLDER}`).join(`${MARKER}${id}`));
    // The module's own text in the map, as it now reads.
    for (const m of parsed.sections ? parsed.sections.map((s) => s.map) : [parsed]) {
      (m.sources || []).forEach((source, i) => {
        if (typeof source === 'string' && source.includes(MARKER) && Array.isArray(m.sourcesContent)) m.sourcesContent[i] = snippet(id);
      });
    }
    if (!parsed.debugId) parsed.debugId = id;
    return { code, map: JSON.stringify(parsed) };
  };
  serialize[WRAPPED] = true;
  return serialize;
}

/** The Metro config with Lyrelog's debug ids in production bundles (once, if given it twice). */
function withLyrelog(config) {
  const serializer = (config && config.serializer) || {};
  if (serializer.customSerializer && serializer.customSerializer[WRAPPED]) return config;
  return { ...config, serializer: { ...serializer, customSerializer: lyrelogSerializer(serializer.customSerializer) } };
}

module.exports = { withLyrelog, snippet, MARKER };
