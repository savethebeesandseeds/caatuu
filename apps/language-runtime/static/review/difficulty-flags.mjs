// Local visual review only, intentionally excluded from app-assets and release exports.
// Production Chrome and learning state render the real Backpack against memory storage.
const values = new Map();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); }
  }
});
await import("/cz/source/shared/course-profile.js?v=course-74");
const { createInterfaceContent, installInterfaceContent } = await import("../source/interface-content.mjs");
const response = await fetch("../data/interface/en.v1.json");
if (!response.ok) throw new Error("Cannot load the interface catalog for flag review.");
installInterfaceContent(createInterfaceContent(await response.json()), window);
await import("../source/learning-profile.js?v=learning-24");
await import("../source/caatuu-chrome.js?v=chrome-197");
window.CaatuuChrome.openSharedSettings({ view: "items" });
document.querySelector(".badge-collection").open = true;
