import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_SETUP_PAYLOAD_MAX_BYTES } from "./product-delivery.mjs";
import { assertPublicSetupDependencies } from "./android-artifact-contract.mjs";
import { validatePagesCurrentReleaseDescriptor } from "./pages-current-release.mjs";
import { readSetupPayloadArchive } from "./setup-payload.mjs";
import { NEW_APK_RESERVE_BYTES, projectPagesCapacity, readPagesStoragePolicy } from "./pages-storage-policy.mjs";

const inventory = JSON.parse(readFileSync(process.argv[2], "utf8"));
assertPublicSetupDependencies({ artifacts: [] }, inventory);
const workspaceRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const descriptor = validatePagesCurrentReleaseDescriptor(JSON.parse(readFileSync(
  resolve(workspaceRoot, "apps/android/tooling/pages-current-release.json"), "utf8")));
const additions = [];
for (const release of descriptor.releases) {
  for (const kind of ["apk", "manifest", "receipt"]) {
    const name = kind === "apk" ? "caatuu.apk" : kind === "manifest" ? "caatuu.json" : "caatuu-release-candidate.json";
    additions.push({ path: `android/releases/${release.versionCode}/${name}`, ...release[kind] });
  }
  if (release.setup && release.versionCode > inventory.android.stableVersionCode) {
    additions.push(...readSetupPayloadArchive(resolve(workspaceRoot, release.setup.sourcePath)).values());
  }
}
// Reserve the entire bounded companion plus two conservative 32 MB APK copies.
// No product transforms or asset generation are repeated before Gradle.
// The final overlay checks the actual complete output against the same cap.
console.log(JSON.stringify(projectPagesCapacity({ inventory, additions,
  archivedApks: readPagesStoragePolicy(descriptor), apkReserveBytes: 2 * NEW_APK_RESERVE_BYTES,
  setupReserveBytes: PRODUCT_SETUP_PAYLOAD_MAX_BYTES })));
