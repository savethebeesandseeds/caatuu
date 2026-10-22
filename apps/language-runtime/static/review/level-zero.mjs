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
const reviewUrl = new URL(globalThis.location.href);
const reviewOptions = reviewUrl.searchParams;
const courseId = reviewOptions.get('course') === 'ar' ? 'ar' : 'zh';
await import(`/${courseId}/source/shared/course-profile.js?v=course-74`);
document.getElementById('levelZeroReviewLabel').textContent = `${window.CaatuuCourse.targetLanguage.label} · Starting out · Local review uses temporary memory only.`;
const { createInterfaceContent, installInterfaceContent } = await import('../source/interface-content.mjs');
const response = await fetch('../data/interface/en.v1.json');
if (!response.ok) throw new Error('Cannot load the review interface catalog.');
installInterfaceContent(createInterfaceContent(await response.json()), window);
await import('../source/learning-profile.js?v=learning-24');
await import('../source/caatuu-chrome.js?v=chrome-194');
window.history.replaceState(window.history.state, '', reviewUrl.href);
if (reviewOptions.get('game') === 'naturalization-nucleus') {
  const markupResponse = await fetch('../app/index.html');
  if (!markupResponse.ok) throw new Error('Cannot load the production game markup for review.');
  const markup = new DOMParser().parseFromString(await markupResponse.text(), 'text/html');
  const panel = markup.getElementById('trainPanelNaturalizationNucleus');
  if (!panel) throw new Error('The production Nucleus panel is missing.');
  const mountedPanel = document.importNode(panel, true);
  mountedPanel.hidden = false;
  document.getElementById('memoryMoonRoot').replaceWith(mountedPanel);
  window.CaatuuPracticePacing = await import('../source/games/practice-pacing.mjs?v=practice-pacing-3');
  await import('../source/games/naturalization-nucleus/naturalization-nucleus.js?v=naturalization-nucleus-32');
  const controller = await window.CaatuuNaturalizationNucleus.mount({
    dataUrl: `/${courseId}/data/games/naturalization-nucleus/content.json`, root: document
  });
  window.addEventListener('pagehide', () => controller?.destroy?.(), { once: true });
} else {
  const { mountMemoryMoon } = await import('../source/games/memory-moon/memory-moon-host.mjs?v=memory-moon-host-9');
  const controller = await mountMemoryMoon({ root: document.getElementById('memoryMoonRoot'),
    shell: window, random: () => 0.37 });
  await controller.ready;
  window.addEventListener('pagehide', () => controller.destroy(), { once: true });
}
