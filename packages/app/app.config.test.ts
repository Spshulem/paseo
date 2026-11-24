import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

// Load the copies the Expo CLI uses for prebuild, not older hoisted ones.
const requireFromExpo = createRequire(require.resolve("expo/package.json"));
const requireFromExpoCli = createRequire(requireFromExpo.resolve("@expo/cli/package.json"));
const { getPrebuildConfigAsync } = requireFromExpoCli("@expo/prebuild-config");
const { compileModsAsync } = requireFromExpoCli(
  "@expo/config-plugins/build/plugins/mod-compiler.js",
);

interface ManifestEntry {
  $: Record<string, string>;
}

const originalFdroidFlag = process.env.PASEO_FDROID_BUILD;

async function resolveAndroidManifest() {
  const { exp } = await getPrebuildConfigAsync(__dirname, { platforms: ["android"] });
  await compileModsAsync(exp, {
    projectRoot: __dirname,
    introspect: true,
    platforms: ["android"],
    assertMissingModProviders: false,
  });
  return exp._internal.modResults.android.manifest.manifest;
}

it("preserves the private Groups identity and local network permission", async () => {
  const previousVariant = process.env.APP_VARIANT;
  try {
    process.env.APP_VARIANT = "groups";
    const { exp } = await getPrebuildConfigAsync(__dirname, { platforms: ["ios"] });
    expect(exp.name).toBe("Paseo Groups");
    expect(exp.scheme).toBe("paseo-groups");
    expect(exp.ios.bundleIdentifier).toBe("app.buildbetter.paseogroups");
    expect(exp.ios.buildNumber).toBe("16001003");
    expect(exp.ios.infoPlist.NSLocalNetworkUsageDescription).toContain("Tailscale");
    expect(exp.ios.infoPlist.NSLocalNetworkUsageDescription).not.toBe(
      "Allow $(PRODUCT_NAME) to find and connect to devices on your local network.",
    );
  } finally {
    if (previousVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousVariant;
  }
}, 30_000);

describe("Android app config", () => {
  afterEach(() => {
    if (originalFdroidFlag === undefined) {
      delete process.env.PASEO_FDROID_BUILD;
    } else {
      process.env.PASEO_FDROID_BUILD = originalFdroidFlag;
    }
  });

  it.each([
    ["Google Play", "0"],
    ["F-Droid", "1"],
  ])(
    "%s build installs on devices without a camera",
    async (_build, fdroidFlag) => {
      process.env.PASEO_FDROID_BUILD = fdroidFlag;
      const manifest = await resolveAndroidManifest();
      const permissions = (manifest["uses-permission"] ?? []).map(
        (entry: ManifestEntry) => entry.$["android:name"],
      );
      const features = (manifest["uses-feature"] ?? []).map((entry: ManifestEntry) => entry.$);

      expect(permissions).toContain("android.permission.CAMERA");
      expect(features).toEqual(
        expect.arrayContaining([
          { "android:name": "android.hardware.camera", "android:required": "false" },
          { "android:name": "android.hardware.camera.autofocus", "android:required": "false" },
        ]),
      );
    },
    30_000,
  );
});

it("follows system rotation on Android", async () => {
  const manifest = await resolveAndroidManifest();
  const activity = manifest.application[0].activity.find(
    (entry: ManifestEntry) => entry.$["android:name"] === ".MainActivity",
  );
  expect(activity.$["android:screenOrientation"]).toBe("unspecified");
}, 30_000);

it("allows all orientations on iPhone and iPad", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "paseo-ios-config-"));
  try {
    const { exp } = await getPrebuildConfigAsync(__dirname, { platforms: ["ios"] });
    await compileModsAsync(exp, {
      projectRoot: root,
      introspect: true,
      platforms: ["ios"],
      assertMissingModProviders: false,
    });
    const plist = exp._internal.modResults.ios.infoPlist;
    const orientations = [
      "UIInterfaceOrientationPortrait",
      "UIInterfaceOrientationPortraitUpsideDown",
      "UIInterfaceOrientationLandscapeLeft",
      "UIInterfaceOrientationLandscapeRight",
    ];
    expect(plist.UISupportedInterfaceOrientations).toEqual(orientations);
    expect(plist["UISupportedInterfaceOrientations~ipad"]).toEqual(orientations);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

// Scene startup is the integration boundary for the iOS keyboard window.
describe("hardware keyboard scene integration", () => {
  it("installs observation after Expo creates the scene window and is idempotent", () => {
    const {
      configureHardwareKeyboardAppDelegate,
    } = require("./modules/paseo-hardware-keyboard/app.plugin.js");
    const source =
      "import Expo\nclass Scene {\n  super.scene(scene, willConnectTo: session, options: connectionOptions)\n}\n";
    const configured = configureHardwareKeyboardAppDelegate(source);
    expect(configured).toContain("import PaseoHardwareKeyboard");
    expect(configured).toContain("PaseoHardwareKeyboardWindow.observing(window)");
    expect(configured.indexOf("super.scene")).toBeLessThan(
      configured.indexOf(".observing(window)"),
    );
    expect(configureHardwareKeyboardAppDelegate(configured)).toBe(configured);
  });
});
