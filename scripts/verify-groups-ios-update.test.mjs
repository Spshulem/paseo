import assert from "node:assert/strict";
import { test } from "vitest";
import { validateGroupsIosUpdate } from "./verify-groups-ios-update.mjs";

function artifact() {
  return {
    info: {
      CFBundleIdentifier: "app.buildbetter.paseogroups",
      DTXcode: "2720",
      DTSDKName: "iphoneos27.2",
      UIDeviceFamily: [1, 2],
      NSLocalNetworkUsageDescription: "Connect to your Paseo hosts over Wi-Fi and Tailscale.",
    },
    entitlements: {
      "application-identifier": "3AVR8P72M4.app.buildbetter.paseogroups",
      "com.apple.developer.team-identifier": "3AVR8P72M4",
    },
  };
}

test("accepts the successful Groups identity without requiring a new keychain namespace", () => {
  assert.doesNotThrow(() => validateGroupsIosUpdate(artifact(), artifact()));
});

test("rejects the official app bundle instead of silently creating a separate data container", () => {
  const candidate = artifact();
  candidate.info.CFBundleIdentifier = "sh.paseo";
  assert.throws(() => validateGroupsIosUpdate(artifact(), candidate), /bundle identifier/);
});

test("rejects signing with a personal team or a changed application identifier prefix", () => {
  const candidate = artifact();
  candidate.entitlements["com.apple.developer.team-identifier"] = "PERSONAL01";
  assert.throws(() => validateGroupsIosUpdate(artifact(), candidate), /signing team/);
  candidate.entitlements["com.apple.developer.team-identifier"] = "3AVR8P72M4";
  candidate.entitlements["application-identifier"] = "OLDPREFIX1.app.buildbetter.paseogroups";
  assert.throws(() => validateGroupsIosUpdate(artifact(), candidate), /application identifier/);
});

test("rejects changed keychain or shared-container access groups", () => {
  const baseline = artifact();
  const candidate = artifact();
  candidate.entitlements["keychain-access-groups"] = ["3AVR8P72M4.other"];
  assert.throws(() => validateGroupsIosUpdate(baseline, candidate), /keychain/);
  delete candidate.entitlements["keychain-access-groups"];
  candidate.entitlements["com.apple.security.application-groups"] = ["group.other"];
  assert.throws(() => validateGroupsIosUpdate(baseline, candidate), /shared-container/);
});

test("treats an explicit default keychain group as equivalent to the signed app default", () => {
  const candidate = artifact();
  candidate.entitlements["keychain-access-groups"] = ["3AVR8P72M4.app.buildbetter.paseogroups"];
  assert.doesNotThrow(() => validateGroupsIosUpdate(artifact(), candidate));
});

test("rejects Xcode 27.1, an old SDK, or dropping iPad support", () => {
  const candidate = artifact();
  candidate.info.DTXcode = "2710";
  assert.throws(() => validateGroupsIosUpdate(artifact(), candidate), /Xcode 27.2/);
  candidate.info.DTXcode = "2720";
  candidate.info.DTSDKName = "iphoneos27.1";
  assert.throws(() => validateGroupsIosUpdate(artifact(), candidate), /SDK 27.2/);
  candidate.info.DTSDKName = "iphoneos27.2";
  candidate.info.UIDeviceFamily = [1];
  assert.throws(() => validateGroupsIosUpdate(artifact(), candidate), /iPhone and iPad/);
});

test("rejects a release bundle that lost its local-network permission text", () => {
  const candidate = artifact();
  candidate.info.NSLocalNetworkUsageDescription = "";
  assert.throws(() => validateGroupsIosUpdate(artifact(), candidate), /local-network/);
});
