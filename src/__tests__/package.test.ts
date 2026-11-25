// What npm gets: checked here because a mistake only shows in someone else's app.
const pkg = require("../../package.json");

describe("package.json", () => {
  it("gives TypeScript the built declarations before any condition that points at the sources", () => {
    // RN's tsconfig sets customConditions ["react-native"]: reaching src/*.ts first would
    // type-check this package's sources with the app's compiler options.
    const conditions = Object.keys(pkg.exports["."]);
    expect(conditions[0]).toBe("types");
  });

  it("builds lib whenever it's packed, not only on publish", () => {
    expect(pkg.scripts.prepack).toBe("pnpm build");
    expect(pkg.files).toContain("lib");
  });
});

// Node's modules, typed only as far as used here (the package has no @types/node).
declare const __dirname: string;
const fs = require("fs") as {
  readFileSync(file: string, encoding: "utf8"): string;
  readdirSync(dir: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
};
const path = require("path") as { join(...parts: string[]): string };
const crypto = require("crypto") as { createHash(name: "sha256"): { update(text: string): { digest(encoding: "hex"): string } } };

const root = path.join(__dirname, "..", "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("version", () => {
  it("is the same in package.json and the Swift and Kotlin bridges, over the native SDKs it needs", () => {
    expect(pkg.version).toBe("1.1.1");
    expect(read("ios/LyrelogBridge.swift")).toContain(`static let wrapperVersion = "${pkg.version}"`);
    expect(read("android/src/main/java/com/lyrelog/reactnative/LyrelogModule.kt")).toContain(`const val WRAPPER_VERSION = "${pkg.version}"`);
    // The native SDKs have their own versions since 1.0.1 (Swift 1.1.1 brought its crash
    // reporter and crashAlreadyReported, which the bridge calls; Android 1.1.1 its ANR and native
    // crash reports, naming the app's own native libraries).
    expect(read("android/build.gradle")).toContain(`"com.lyrelog:lyrelog-android:1.1.1"`);
    expect(read("LyrelogReactNative.podspec")).toContain(`minimumVersion: "1.1.2"`);
  });
});

describe("metadata", () => {
  it("names Lyrelog, its repository and supported ranges", () => {
    expect(pkg.author).toBe("Lyrelog <hello@lyrelog.com>");
    expect(pkg.homepage).toBe("https://lyrelog.com");
    expect(pkg.repository.url).toBe("git+https://github.com/lyrelog/lyrelog-react-native.git");
    expect(pkg.bugs.url).toBe("https://github.com/lyrelog/lyrelog-react-native/issues");
    expect(pkg.peerDependencies).toEqual({ react: ">=19.0.0 <20.0.0", "react-native": ">=0.80.0 <1.0.0" });
    const podspec = read("LyrelogReactNative.podspec");
    expect(podspec).toContain('"https://github.com/lyrelog/lyrelog-react-native.git"');
    expect(podspec).toContain('{ "Lyrelog" => "hello@lyrelog.com" }');
    expect(read("LICENSE")).toContain("Copyright (c) 2026 Lyrelog\n");
  });

  it("exports LyrelogClient only as a type: a second client would take over the error hooks", () => {
    const index = require("../index");
    expect(index.LyrelogClient).toBeUndefined();
    expect(typeof index.Lyrelog.captureError).toBe("function");
  });
});

// The SHA-256 of words that must never appear in what's published (a real person's name and
// handle, his apps), so this test doesn't spell them.
const PRIVATE_WORDS = new Set([
  "4859d1729b697a9ccc9bf17b6a3c676bc935834e5640d203a7cfa489bd45d619",
  "f9744307fc9594a5eb864e9985ff0c89049a38d6296dedf4fdb1de060026af72",
  "8c1f2223a334499ddaf4a7766e2f3a737d13dea150e8276f679353f6ac3f59af",
  "581f689aa61c4ba463c3a341c2e8ad190e556e9fd406126444bb1d0e3a03d7f5",
  "69040a334ba12e14ddbdfd1ce418bca0cc9c815821c3a3fc8d7cff8e461cbbbd",
  "3e321b156622dee42a32fa28375a5265343e5ccf98f01bd3736bb15f30edd8a0",
  "3a4476b0d32cfc2a67e76142cf19bd49f81995ecbb9e87037a80d69f0b98ec54",
  "d79f181eeeab44eac51ed1311f4a930b8287ff77c2102d95f379c7ef2c40e8e1",
  "bf372aa4f4a8ed51c8ad1704e09d0af6f33efcb27da29112295caabd1965bcf3",
  "c09e52f5c52c2b7d67b7c2b07ac26811953c0e87fca1511e37b9de030cac47ed",
  "7cd6103d8391f49943e123ae089e6fffdba641108b7ee145fc9aaaaeddeabb16",
  "36a6e33145f824f805ea3585c637f8082cb2fb4543dbe32076e60b6a5260b7a1",
  "7b82c523924430937ced2ce962d3858a26c006a64ed606ca20ab301fbd4c9919",
  "e3cfb6acbaca0d4d56a04cac7ff5a4c288aaa8c90e60a4c1c99c87204a736fc9",
  "eaa734a79af4f283eab33f5704730a5c4c2f37f73b432558213464384d649b51",
  "81240b78fc3f5be98b4b4729348f00b46fa4361b5f66074187be1e1ff4f0825e",
  "7022a485fd53aa97a093899684340b7fbe5c071718cf6087d1d7087dd3a0b07c",
  "976c617a20d12e4261e40bd8e4ce88493578ec463d082af3b2784b642b82ef0d",
  "b9e5b115929357704655d70d95b79daf630c3cea6e084adec79b4bcb7e0cd7b1",
  "34eb8131c759d8ea0bdf432f943e6e78d8bd2e1d9ad50f2bf166fad074edcea8",
  "7e421181fc7b52ab66f2c22bd396acce92c3cdd9a29122dde0f1b7ddc0eb4435",
]);

function publicFiles(): string[] {
  const out = ["README.md", "LICENSE", "package.json", "LyrelogReactNative.podspec", "android/build.gradle", "example/package.json", "example/app.json", "metro.js", "example/metro.config.js", "example/ios/Driftwood.xcodeproj/project.pbxproj"];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|tsx|js|swift|kt|mm|h)$/.test(entry.name)) out.push(file);
    }
  };
  for (const dir of ["src", "ios", "android/src", "example/src"]) walk(dir);
  return out;
}

describe("public files", () => {
  // A signing team id names the developer it belongs to: the example signs with whoever runs it.
  it("sign with no team of anyone's", () => {
    const pbxproj = fs.readFileSync(path.join(root, "example/ios/Driftwood.xcodeproj/project.pbxproj"), "utf8");
    expect(pbxproj.match(/DEVELOPMENT_TEAM = [A-Z0-9]{10};/g) ?? []).toEqual([]);
  });

  it("name no real person", () => {
    const found: string[] = [];
    for (const file of publicFiles()) {
      for (const word of read(file).toLowerCase().split(/[^a-z0-9]+/)) {
        if (word && PRIVATE_WORDS.has(crypto.createHash("sha256").update(word).digest("hex"))) found.push(file);
      }
    }
    expect(found).toEqual([]);
  });
});
