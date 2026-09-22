import vm from "node:vm";

// These checks describe the product's course-scoped wiring. They deliberately
// avoid requiring the obsolete, activity-wide dictionary manager variable.
export function validateNativeDictionaryRouting({ activitySource, courseRuntimeSource, bridgeSource }) {
  const issues = [];
  const require = (condition, message) => { if (!condition) issues.push(message); };
  const compact = value => String(value || "").replace(/\s+/gu, " ");
  const activity = compact(activitySource);
  const runtime = compact(courseRuntimeSource);
  const bridge = compact(bridgeSource);

  require(/dictionaryFactory\s*=\s*\{\s*\w+\.dictionary\?\.let\s*\{\s*(\w+)\s*->[\s\S]*?DictionaryManager\([^)]*catalogAssetPath\s*=\s*\1\.catalogAsset/u.test(activity),
    "Product dictionary factories must be capability-gated and receive the declared course catalog.");
  require(/ProductBridge\([^]*?courseRuntimes\s*=\s*\w+/u.test(activity),
    "ProductBridge must receive the per-course runtime map.");

  const dictionaryService = /val\s+(\w+)\s*=\s*lazy\s*\{\s*dictionaryFactory\(\)/u.exec(runtime)?.[1];
  require(Boolean(dictionaryService), "Course dictionary services must be constructed lazily from their factory.");
  require(/check\s*\(\s*\(\s*\w+\.dictionary\s*!=\s*null\s*\)\s*==\s*\(\s*it\s*!=\s*null\s*\)\s*\)/u.test(runtime),
    "Course dictionary service availability must match the declared native provider.");
  require(Boolean(dictionaryService) && new RegExp(`val\\s+dictionaryManager\\s*:\\s*DictionaryManager\\?\\s+get\\(\\)\\s*=\\s*${dictionaryService}\\.value`, "u").test(runtime),
    "The course dictionary manager must expose its lazy service.");

  const resolver = /fun\s+(\w+)\(\)\s*:\s*ProductCourseRuntime\s*\{([^]*?)\}/u.exec(bridge);
  const trustedCourse = resolver && /val\s+(\w+)\s*=\s*\w+\.courseForTrustedUrl\(\s*\w+\.url\s*\)\s*\?:\s*throw/u.exec(resolver[2]);
  require(Boolean(trustedCourse) && new RegExp(`return\\s+\\w+\\[\\s*${trustedCourse?.[1]}\\.id\\s*\\]\\s*\\?:\\s*throw`, "u").test(resolver?.[2] || ""),
    "Dictionary requests must select a bundled runtime from the trusted WebView course URL.");
  const selectedRuntime = resolver && new RegExp(`val\\s+(\\w+)\\s*=\\s*${resolver[1]}\\(\\)`, "u").exec(bridge)?.[1];
  require(Boolean(selectedRuntime) && ["status", "download", "search"].every(operation => {
    const arm = new RegExp(`"dictionary_${operation}"\\s*->([^]*?)(?= "[a-z_]+"\\s*->|$)`, "u").exec(bridge)?.[1] || "";
    return new RegExp(`\\b${selectedRuntime}\\b`, "u").test(arm);
  }), "All dictionary operations must use the trusted request's selected course runtime.");
  require(/fun\s+\w+\(\s*(\w+)\s*:\s*ProductCourseRuntime\s*\)\s*:\s*DictionaryManager\s*=\s*\1\.dictionaryManager\s*\?:\s*throw/u.test(bridge),
    "Dictionary operations must fail closed when the selected course has no native dictionary provider.");
  return Object.freeze(issues);
}

// Exercise the public UI contract, not a private variable name or translated
// label. No document, course, native bridge, network or timers are installed.
export function validateMaintenanceUpdateVisibility(maintenanceSource) {
  const issues = [];
  const context = vm.createContext({ window: {}, CaatuuI18n: { t: id => id } });
  try {
    vm.runInContext(String(maintenanceSource), context, { timeout: 1000 });
    const ui = context.window.CaatuuMaintenanceUi;
    if (typeof ui?.setUpdateAppControl !== "function") return Object.freeze(["Maintenance must expose its shared update-control renderer."]);
    const newer = { selfUpdateEnabled: true, updateAvailable: true, currentVersionCode: 10, latestVersionCode: 11 };
    const cases = [
      ["native without update", "android", { ...newer, updateAvailable: false }, false, false],
      ["store-managed native", "android", { ...newer, selfUpdateEnabled: false }, false, false],
      ["native newer update", "android", newer, true, false],
      ["native current version", "android", { ...newer, latestVersionCode: 10 }, false, false],
      ["native older version", "android", { ...newer, latestVersionCode: 9 }, false, false],
      ["native active download", "android", { ...newer, updateAvailable: false, downloadActive: true }, true, true],
      ["native verified download", "android", { ...newer, updateAvailable: false, downloadReady: true }, true, false],
      ["browser without update", "browser", { updateAvailable: false }, false, false],
      ["browser ready update", "browser", { updateAvailable: true, selfUpdateEnabled: false }, true, false]
    ];
    for (const [name, env, status, visible, downloading] of cases) {
      for (const busy of [false, true]) {
        const attributes = new Map();
        const row = { hidden: false, classList: { toggle() {} }, querySelector: () => null };
        const button = { hidden: false, disabled: false, textContent: "", classList: { toggle() {} },
          querySelector: () => null, closest: () => row,
          setAttribute: (key, value) => attributes.set(key, value) };
        ui.setUpdateAppControl(button, { env }, status, { busy });
        const disabled = busy || !visible || downloading;
        if (button.hidden !== !visible || row.hidden !== !visible || button.disabled !== disabled
          || attributes.get("aria-disabled") !== String(disabled)) {
          issues.push(`Update controls must preserve availability and operation state for ${name}${busy ? " while busy" : ""}.`);
        }
      }
    }
  } catch (error) {
    issues.push(`Maintenance update-control validation could not run: ${error.message}`);
  }
  return Object.freeze(issues);
}
