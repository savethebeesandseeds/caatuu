// Local review of the production beginner host, excluded from app asset catalogs.
// No answers or preferences from this page touch the learner's saved profile.
const values = new Map();
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.get(String(key)) ?? null; },
  setItem(key, value) { values.set(String(key), String(value)); },
  removeItem(key) { values.delete(String(key)); }
} });
await import('/zh/source/shared/course-profile.js?v=course-72');
const { createInterfaceContent, installInterfaceContent } = await import('../source/interface-content.mjs');
const response = await fetch('../data/interface/en.v1.json');
if (!response.ok) throw new Error('Cannot load the review interface catalog.');
installInterfaceContent(createInterfaceContent(await response.json()), window);
await import('../source/learning-profile.js?v=learning-22');
await import('../source/caatuu-chrome.js?v=chrome-190');
const { mountMemoryMoon } = await import('../source/games/memory-moon/memory-moon-host.mjs?v=memory-moon-host-7');
const controller = await mountMemoryMoon({ root: document.getElementById('memoryMoonRoot'),
  shell: window, random: () => 0.37 });
await controller.ready;
window.addEventListener('pagehide', () => controller.destroy(), { once: true });
