import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { isMainModule } from "./is-main-module.mjs";

const bundleId = "app.buildbetter.paseogroups";
const teamId = "3AVR8P72M4";
const applicationId = `${teamId}.${bundleId}`;

function groups(entitlements, key, fallback = []) {
  return [...new Set(entitlements[key] ?? fallback)].sort();
}

export function validateGroupsIosUpdate(baseline, candidate) {
  for (const artifact of [baseline, candidate]) {
    if (artifact.info.CFBundleIdentifier !== bundleId) {
      throw new Error("Groups bundle identifier must remain unchanged.");
    }
    if (artifact.entitlements["com.apple.developer.team-identifier"] !== teamId) {
      throw new Error("Groups signing team must remain Build Better, Inc.");
    }
    if (artifact.entitlements["application-identifier"] !== applicationId) {
      throw new Error("Groups application identifier and signing prefix must remain unchanged.");
    }
  }
  for (const [key, fallback, label] of [
    ["keychain-access-groups", [applicationId], "keychain"],
    ["com.apple.security.application-groups", [], "shared-container"],
  ]) {
    if (
      JSON.stringify(groups(baseline.entitlements, key, fallback)) !==
      JSON.stringify(groups(candidate.entitlements, key, fallback))
    ) {
      throw new Error(`Groups ${label} access groups changed; review migration before installing.`);
    }
  }
  const info = candidate.info;
  if (!Number.isFinite(Number(info.DTXcode)) || Number(info.DTXcode) < 2720) {
    throw new Error("Groups requires Xcode 27.2 or newer.");
  }
  const sdk = /^iphoneos(\d+)\.(\d+)$/.exec(info.DTSDKName ?? "");
  if (!sdk || Number(sdk[1]) < 27 || (Number(sdk[1]) === 27 && Number(sdk[2]) < 2)) {
    throw new Error("Groups requires iPhoneOS SDK 27.2 or newer.");
  }
  if (!info.UIDeviceFamily?.includes(1) || !info.UIDeviceFamily?.includes(2)) {
    throw new Error("Groups must retain support for both iPhone and iPad.");
  }
  const permission = info.NSLocalNetworkUsageDescription;
  if (typeof permission !== "string" || !permission.includes("Tailscale")) {
    throw new Error("Groups release bundle lost its custom local-network permission text.");
  }
}

function readArtifact(appPath) {
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "pipe",
  });
  const info = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(appPath, "Info.plist")], {
      encoding: "utf8",
    }),
  );
  const xml = execFileSync("/usr/bin/codesign", ["-d", "--entitlements", ":-", appPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entitlements = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
      input: xml,
      encoding: "utf8",
    }),
  );
  return { info, entitlements };
}

if (isMainModule(import.meta.url)) {
  try {
    const [baselinePath, candidatePath, ...extra] = process.argv.slice(2);
    if (!baselinePath || !candidatePath || extra.length) {
      throw new Error(
        "Usage: node scripts/verify-groups-ios-update.mjs BASELINE.app CANDIDATE.app",
      );
    }
    validateGroupsIosUpdate(readArtifact(baselinePath), readArtifact(candidatePath));
    console.log(
      "PASS: Groups signing, container identity, SDK, and local-network permission are compatible. Real-device connection checks are still required.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Groups update verification failed.");
    process.exitCode = 1;
  }
}
