import { readEmbeddedCourseProfile } from '../course-game-content.mjs';
import { mountMemoryMoon } from './memory-moon-host.mjs?v=memory-moon-host-7';

/** Keep shell authority and visibility messages confined to the same-origin parent. */
export async function startMemoryMoon(scope = window, { mount = mountMemoryMoon } = {}) {
  const root = scope.document.getElementById('memoryMoonRoot');
  const course = readEmbeddedCourseProfile(scope);
  scope.document.documentElement.lang = course.sourceLanguage?.locale || 'en';
  scope.document.documentElement.dir = course.sourceLanguage?.direction || 'ltr';
  const shell = scope.parent === scope ? scope : scope.parent;
  let controller, disposed = false, pageSuspended = false;
  let active = shell === scope || Boolean(shell.document.getElementById('view-verbs')?.classList.contains('is-active')
    && shell.document.querySelector('[data-train-panel="memory-moon"]')?.hidden === false
    && !shell.CaatuuGameDynamics?.active);
  const campaign = () => shell.document.body?.dataset.campaignActive === 'true';
  const appearance = message => {
    for (const [key, allowed] of [['theme', ['light', 'dark']],
      ['fontSize', ['largest', 'large', 'medium', 'small', 'standard', 'smaller']]]) {
      if (allowed.includes(message[key])) scope.document.documentElement.dataset[key] = message[key];
    }
  };
  const receive = event => {
    if (disposed || event.source !== shell || event.origin !== scope.location.origin
      || event.data?.source !== 'caatuu-app-shell') return;
    const message = event.data;
    if (message.type === 'visibility') {
      active = message.active === true;
      appearance(message);
      controller?.setCampaign(campaign());
      controller?.setActive(active);
    } else if (['theme', 'fontSize'].includes(message.type)) appearance(message);
    else if (message.type === 'campaign-advance' && campaign()
      && controller?.snapshot?.()?.phase === 'complete') {
      active = false;
      controller.setActive(false);
      void controller?.restart();
    }
  };
  const removeListeners = () => {
    scope.removeEventListener('message', receive);
    scope.removeEventListener('pagehide', pageHide);
    scope.removeEventListener('pageshow', pageShow);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    removeListeners();
    controller?.destroy();
  };
  const pageHide = event => {
    if (!event.persisted) { dispose(); return; }
    pageSuspended = true;
    controller?.setPaused(true);
  };
  const pageShow = () => {
    if (disposed) return;
    pageSuspended = false;
    controller?.setPaused(false);
    controller?.setActive(active);
  };
  scope.addEventListener('message', receive);
  scope.addEventListener('pagehide', pageHide);
  scope.addEventListener('pageshow', pageShow);
  appearance(shell.document.documentElement.dataset);
  try {
    const mounted = await mount({ root, shell, course, active, campaign: campaign() });
    if (disposed) { mounted?.destroy(); return null; }
    controller = mounted;
    controller.setActive(active);
    controller.setCampaign(campaign());
    controller.setPaused(pageSuspended);
    return { ...controller, destroy: dispose, dispose,
      setActive(value) { active = value === true; if (!disposed) controller.setActive(active); }
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

if (typeof window !== 'undefined' && window.document.getElementById('memoryMoonRoot')) {
  startMemoryMoon().catch(() => {
    const root = document.getElementById('memoryMoonRoot');
    root.setAttribute('aria-busy', 'false');
    root.setAttribute('role', 'alert');
    root.textContent = 'Memory Moon could not start. Open it from a course and try again.';
  });
}
