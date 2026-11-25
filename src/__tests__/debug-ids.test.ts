import { frameURL } from "../debug-ids";
import { describe as describeError } from "../errors";

const g = globalThis as Record<string, unknown>;
const ID = "8d7e1c84-33e6-472e-9490-6d67c80a3d06";

afterEach(() => {
  delete g._lyrelogDebugIds;
});

describe("debug ids", () => {
  it("reads a frame's bundle as Hermes, JavaScriptCore and V8 print it", () => {
    expect(frameURL("    at onPress (address at index.android.bundle:1:654321)")).toBe("index.android.bundle");
    expect(frameURL("    at anonymous (address at /data/app/main.jsbundle:1:12)")).toBe("/data/app/main.jsbundle");
    expect(frameURL("onPress@main.jsbundle:1:1234")).toBe("main.jsbundle");
    expect(frameURL("    at onPress (http://localhost:8081/index.bundle?platform=ios:120:5)")).toBe("http://localhost:8081/index.bundle?platform=ios");
    expect(frameURL("    at apply (native)")).toBeUndefined();
  });

  it("an error from a bundle withLyrelog gave an id carries it", () => {
    (g._lyrelogDebugIds = {} as Record<string, string>)["Error\n    at anonymous (address at main.jsbundle:1:200)\n    at global (address at main.jsbundle:1:9)"] = ID;
    const error = new TypeError("Driftwood is not a function");
    error.stack = "TypeError: Driftwood is not a function\n    at onPress (address at main.jsbundle:1:654321)\n    at apply (native)";
    expect(describeError(error).payload.debug_ids).toEqual({ "main.jsbundle": ID });
  });

  it("an error without one carries none", () => {
    const error = new Error("Bucket handle snapped");
    error.stack = "Error: Bucket handle snapped\n    at onPress (address at main.jsbundle:1:654321)";
    expect(describeError(error).payload).not.toHaveProperty("debug_ids");
  });
});
