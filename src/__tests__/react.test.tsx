import * as React from "react";
import { Text } from "react-native";
import { act, create } from "react-test-renderer";
import { LyrelogClient } from "../client";
import { resetErrorHooksForTests } from "../errors";
import { LyrelogErrorBoundary, trackNavigation } from "../react";
import { fakeNative } from "./fakes";

function client() {
  resetErrorHooksForTests();
  const native = fakeNative();
  return { native, client: new LyrelogClient(native, () => ({})).init({ apiKey: "k" }) };
}

describe("trackNavigation", () => {
  it("reports the focused route on ready and on each change, then calls yours", () => {
    const { native, client: c } = client();
    let route: { name: string } | undefined = { name: "Shore" };
    const ref = { current: { getCurrentRoute: () => route } };
    const mine = jest.fn();
    const props = trackNavigation(ref, { client: c, onStateChange: mine });
    props.onReady();
    route = { name: "Finds" };
    props.onStateChange({ index: 1 });
    route = undefined;
    props.onStateChange(undefined);
    expect(native.named("screen").map((call) => call.args[0])).toEqual(["Shore", "Finds"]);
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it("renames or skips routes", () => {
    const { native, client: c } = client();
    const ref = { getCurrentRoute: () => ({ name: "modal-sheet" }) };
    trackNavigation(ref, { client: c, name: () => undefined }).onReady();
    trackNavigation(ref, { client: c, name: (r) => r.name.toUpperCase() }).onReady();
    expect(native.named("screen").map((call) => call.args[0])).toEqual(["MODAL-SHEET"]);
  });
});

describe("LyrelogErrorBoundary", () => {
  function Broken(): React.ReactElement {
    throw new Error("cannot draw");
  }

  it("records the error with its component stack and shows the fallback", () => {
    const { native, client: c } = client();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <LyrelogErrorBoundary client={c} category="finds" fallback={({ reset }) => <Text onPress={reset}>Something broke</Text>}>
          <Broken />
        </LyrelogErrorBoundary>,
      );
    });
    spy.mockRestore();
    expect(JSON.stringify(tree.toJSON())).toContain("Something broke");
    const call = native.named("log")[0];
    expect(call.args.slice(0, 3)).toEqual(["error", "exception", "finds"]);
    expect(call.args[3]).toMatchObject({ mechanism: "error_boundary", error_type: "Error", error_message: "cannot draw" });
    expect((call.args[4] as { value: { component_stack: string } }).value.component_stack).toContain("Broken");
  });
});
