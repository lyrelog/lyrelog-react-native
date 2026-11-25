/* eslint-disable @typescript-eslint/no-require-imports */
const { withLyrelog, snippet, MARKER } = require("../../metro");

const PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

// Node's, as Metro runs there (the package's types are React Native's).
declare const Buffer: { from(text: string): { toString(): string } };
type Buffer = { toString(): string };

/** A one-module app, as Metro's graph and serializer options carry it. */
function app(code = 'console.log("tide");') {
  const path = "/srv/driftwood/index.js";
  const module = {
    path,
    dependencies: new Map(),
    inverseDependencies: new Set(),
    getSource: () => Buffer.from(code),
    output: [{ type: "js/script", data: { code, lineCount: 1, map: [[1, 0, 1, 0]], functionMap: null } }],
  };
  const graph = { dependencies: new Map([[path, module]]), entryPoints: new Set([path]) };
  const options = {
    dev: false,
    modulesOnly: false,
    projectRoot: "/srv/driftwood",
    serverRoot: "/srv/driftwood",
    createModuleId: () => 0,
    processModuleFilter: () => true,
    shouldAddToIgnoreList: () => false,
    getSourceUrl: null,
    getRunModuleStatement: (id: number) => `__r(${id});`,
    runBeforeMainModule: [],
    runModule: false,
    inlineSourceMap: false,
    sourceMapUrl: null,
    sourceUrl: null,
    asyncRequireModulePath: "",
    includeAsyncPaths: false,
  };
  return { entry: path, graph, options };
}

const serializerOf = (config: { serializer: { customSerializer: Function } }) => config.serializer.customSerializer;

describe("withLyrelog", () => {
  it("gives a release bundle its id: first line, comment, map and the module's name", async () => {
    const { entry, graph, options } = app();
    const out = await serializerOf(withLyrelog({}))(entry, [], graph, options);
    const id = /\/\/# debugId=(\S+)/.exec(out.code)![1];
    expect(out.code.startsWith(snippet(id))).toBe(true);
    const map = JSON.parse(out.map);
    expect(map.debugId).toBe(id);
    expect(JSON.stringify(map)).toContain(`${MARKER}${id}.js`);
    expect(out.code + out.map).not.toContain(PLACEHOLDER);
  });

  it("leaves the same text elsewhere in the app as it was", async () => {
    const { entry, graph, options } = app(`const empty = "${PLACEHOLDER}";`);
    const out = await serializerOf(withLyrelog({}))(entry, [], graph, options);
    expect(out.code).toContain(`const empty = "${PLACEHOLDER}";`);
  });

  it("leaves development bundles and a split bundle's modules alone", async () => {
    for (const extra of [{ dev: true }, { modulesOnly: true }]) {
      const { entry, graph, options } = app();
      const out = await serializerOf(withLyrelog({}))(entry, [], graph, { ...options, ...extra });
      expect(typeof out === "string" ? out : out.code).not.toContain("_lyrelogDebugIds");
    }
  });

  it("computes the map when a serializer before it gives only code", async () => {
    const { entry, graph, options } = app();
    const upstream = async (_e: string, pre: { getSource(): Buffer }[]) => ({ code: pre[0]!.getSource().toString() + "\nconsole.log(1);" });
    const out = await serializerOf(withLyrelog({ serializer: { customSerializer: upstream } }))(entry, [], graph, options);
    expect(JSON.parse(out.map).debugId).toBe(/\/\/# debugId=(\S+)/.exec(out.code)![1]);
  });

  it("returns what a serializer before it makes when it isn't a JavaScript bundle (Expo's static output)", async () => {
    const { entry, graph, options } = app();
    const files = JSON.stringify([{ filename: "_expo/static/js/web/index.js", source: "x" }]);
    const upstream = async () => files;
    const out = await serializerOf(withLyrelog({ serializer: { customSerializer: upstream } }))(entry, [], graph, options);
    expect(out).toBe(files);
  });

  it("keeps the debugId another tool gave the map, and wraps a config once", async () => {
    const { entry, graph, options } = app();
    const upstream = async (_e: string, pre: { getSource(): Buffer }[]) => ({
      code: pre[0]!.getSource().toString() + "\n//# debugId=11111111-2222-4333-8444-555555555555",
      map: JSON.stringify({ version: 3, sources: [`/srv/driftwood/${MARKER}${PLACEHOLDER}.js`], names: [], mappings: "AAAA", debugId: "11111111-2222-4333-8444-555555555555" }),
    });
    const once = withLyrelog({ serializer: { customSerializer: upstream } });
    expect(withLyrelog(once)).toBe(once);
    const out = await serializerOf(once)(entry, [], graph, options);
    const map = JSON.parse(out.map);
    expect(map.debugId).toBe("11111111-2222-4333-8444-555555555555");
    expect(out.code.match(/\/\/# debugId=/g)).toHaveLength(1);
    expect(map.sources[0]).toMatch(new RegExp(`${MARKER}[0-9a-f-]{36}\\.js$`));
    expect(map.sources[0]).not.toContain(PLACEHOLDER);
  });
});
