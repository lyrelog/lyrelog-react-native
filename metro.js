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
 * bundle's code, so the same code gets the same id. Development bundles are left as they are.
 */
const crypto = require('node:crypto');

const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';
const MARKER = '__lyrelog_debug_id__';

function snippet(id) {
  return (
    ';!function(){try{var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{},' +
    'n=(new e.Error).stack;n&&((e._lyrelogDebugIds=e._lyrelogDebugIds||{})[n]="' +
    id +
    '")}catch(e){}}();'
  );
}

/** Metro's own serializer pieces (public under `metro/private` from 0.83, `metro/src` before). */
function metro(path) {
  try {
    return require(`metro/private/${path}`);
  } catch {
    return require(`metro/src/${path}`);
  }
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
  const path = require('node:path').join(projectRoot || process.cwd(), `${MARKER}${PLACEHOLDER}.js`);
  return {
    dependencies: new Map(),
    getSource: () => Buffer.from(code),
    inverseDependencies: new Set(),
    path,
    output: [{ type: 'js/script/virtual', data: { code, lineCount: 1, map: [[1, 0, 1, 0]], functionMap: null } }],
  };
}

function lyrelogSerializer(upstream) {
  return async (entryPoint, preModules, graph, options) => {
    if (options.dev) {
      if (upstream) return upstream(entryPoint, preModules, graph, options);
      const baseJSBundle = metro('DeltaBundler/Serializers/baseJSBundle').default;
      const bundleToString = metro('lib/bundleToString').default;
      return bundleToString(baseJSBundle(entryPoint, preModules, graph, options)).code;
    }
    const pre = [debugIdModule(options.projectRoot), ...preModules];
    let code;
    let map;
    const out = upstream ? await upstream(entryPoint, pre, graph, options) : undefined;
    if (out && typeof out === 'object') {
      code = out.code;
      map = out.map;
    } else {
      if (typeof out === 'string') {
        code = out;
      } else {
        const baseJSBundle = metro('DeltaBundler/Serializers/baseJSBundle').default;
        const bundleToString = metro('lib/bundleToString').default;
        code = bundleToString(baseJSBundle(entryPoint, pre, graph, options)).code;
      }
      const { sourceMapString } = metro('DeltaBundler/Serializers/sourceMapString');
      const modules = [...graph.dependencies.values()].sort((a, b) => options.createModuleId(a.path) - options.createModuleId(b.path));
      map = sourceMapString([...pre, ...modules], {
        excludeSource: false,
        processModuleFilter: options.processModuleFilter,
        shouldAddToIgnoreList: options.shouldAddToIgnoreList,
        getSourceUrl: options.getSourceUrl,
      });
    }
    const id = idOf(code);
    code = code.split(PLACEHOLDER).join(id) + `\n//# debugId=${id}\n`;
    const parsed = JSON.parse(map.split(PLACEHOLDER).join(id));
    parsed.debugId = id;
    return { code, map: JSON.stringify(parsed) };
  };
}

/** The Metro config with Lyrelog's debug ids in production bundles. */
function withLyrelog(config) {
  const serializer = (config && config.serializer) || {};
  return { ...config, serializer: { ...serializer, customSerializer: lyrelogSerializer(serializer.customSerializer) } };
}

module.exports = { withLyrelog, snippet, MARKER };
