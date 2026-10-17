// Decorative Moon orbit; headings come from the authoritative ship catalog.
const turn = Math.PI * 2;
const degrees = 180 / Math.PI;
const wrapped = value => ((value % 360) + 360) % 360;
const signed = value => ((value + 180) % 360 + 360) % 360 - 180;
const unitRandom = random => {
  const value = Number(random());
  return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0;
};

export function chooseMoonShip(catalog, { random = Math.random } = {}) {
  const ships = Object.entries(catalog || {}).flatMap(([href, entry]) => {
    const headingDegrees = entry?.orientation?.heading_degrees;
    if (!/^\/assets\/ships\/[^/\\?#]+\.png$/i.test(href) || entry?.category !== "ship"
        || !Number.isFinite(headingDegrees) || headingDegrees < 0 || headingDegrees >= 360) return [];
    try {
      const filename = decodeURIComponent(href.slice("/assets/ships/".length));
      if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return [];
    } catch { return []; }
    return [{ href, headingDegrees, description: String(entry.description || "") }];
  });
  if (!ships.length) return null;
  return ships[Math.floor(unitRandom(random) * ships.length)];
}

/** One tilted orbit around the SVG Moon. Positive depth is the visible front. */
export function moonOrbitPose(progress, headingDegrees, { tiltDegrees = -15, direction = 1 } = {}) {
  if (!Number.isFinite(progress) || !Number.isFinite(headingDegrees) || !Number.isFinite(tiltDegrees)
      || (direction !== 1 && direction !== -1)) {
    throw new TypeError("A Moon orbit needs finite progress and a catalog heading.");
  }
  const angle = direction * ((progress % 1 + 1) % 1) * turn + Math.PI / 2;
  const depth = Math.sin(angle);
  const localX = 94 * Math.cos(angle), localY = 32 * depth;
  const tilt = tiltDegrees / degrees;
  const cos = Math.cos(tilt), sin = Math.sin(tilt);
  const tangentX = -direction * 94 * Math.sin(angle), tangentY = direction * 32 * Math.cos(angle);
  const heading = wrapped(Math.atan2(tangentX * sin + tangentY * cos,
    tangentX * cos - tangentY * sin) * degrees);
  const direct = signed(heading - headingDegrees);
  const reflected = signed(heading - wrapped(180 - headingDegrees));
  // Pick the equivalent pose requiring less roll of the original artwork.
  const mirror = Math.abs(reflected) < Math.abs(direct);
  return { x: 100 + localX * cos - localY * sin, y: 100 + localX * sin + localY * cos,
    heading, rotation: mirror ? reflected : direct, mirror,
    scale: 0.88 + 0.12 * depth, visible: depth >= -1e-9 };
}

/** The ship is a sibling overlay so the Moon's opacity never fades the craft. */
export function createMoonOrbit({ element, image, document: doc = globalThis.document,
  reducedMotion, random = Math.random, periodMs = 12000, requestFrame, cancelFrame } = {}) {
  if (!element || !image || !doc || !(periodMs > 0) || !Number.isFinite(periodMs)) {
    throw new TypeError("A Moon orbit needs its SVG elements, document and a positive period.");
  }
  const view = doc.defaultView || globalThis;
  const motion = reducedMotion || view.matchMedia?.("(prefers-reduced-motion: reduce)");
  const request = requestFrame || view.requestAnimationFrame?.bind(view);
  const cancel = cancelFrame || view.cancelAnimationFrame?.bind(view);
  let selected = null, loaded = false, destroyed = false, paused = false, pageActive = true;
  let progress = 0, previousTime = null, frame = null, generation = 0, selection = 0;
  let geometry = { tiltDegrees: -15, direction: 1 }, reroutePending = false;
  let onLoad, onError;

  const moving = () => selected && loaded && !destroyed && !paused && pageActive
    && !doc.hidden && !motion?.matches && typeof request === "function";
  function draw() {
    const pose = moonOrbitPose(progress, selected?.headingDegrees || 0, geometry);
    element.setAttribute("transform", `translate(${pose.x} ${pose.y}) rotate(${pose.rotation}) scale(${pose.mirror ? -pose.scale : pose.scale} ${pose.scale})`);
    element.setAttribute("visibility", !destroyed && selected && loaded && pose.visible ? "visible" : "hidden");
    element.setAttribute("opacity", "1");
  }
  function stop() {
    generation += 1;
    if (frame !== null) cancel?.(frame);
    frame = null;
    previousTime = null;
  }
  function schedule() {
    if (frame !== null || !moving()) return;
    const current = generation;
    frame = request(now => {
      if (current !== generation || !moving()) return;
      frame = null;
      if (previousTime !== null) {
        const next = progress + Math.max(0, now - previousTime) / periodMs;
        if (Math.floor(next + 0.5) > Math.floor(progress + 0.5)) reroutePending = true;
        progress = next % 1;
        // Change course out of sight, including after a stalled frame skips the rear arc.
        if (reroutePending && !moonOrbitPose(progress, selected.headingDegrees, geometry).visible) {
          geometry.tiltDegrees = (geometry.tiltDegrees + 45 + unitRandom(random) * 270) % 360;
          reroutePending = false;
        }
      }
      previousTime = now;
      draw();
      schedule();
    });
  }
  function refresh() {
    stop();
    if (motion?.matches) { progress = 0; reroutePending = false; } // Keep a visible static pose.
    draw();
    schedule();
  }
  function clearImageListeners() {
    if (onLoad) image.removeEventListener("load", onLoad);
    if (onError) image.removeEventListener("error", onError);
  }
  const onVisibility = () => refresh();
  const onPageHide = () => { pageActive = false; refresh(); };
  const onPageShow = () => { pageActive = true; refresh(); };
  doc.addEventListener("visibilitychange", onVisibility);
  view.addEventListener?.("pagehide", onPageHide);
  view.addEventListener?.("pageshow", onPageShow);
  motion?.addEventListener?.("change", refresh);
  draw();

  return {
    select(catalog) {
      if (destroyed) return null;
      stop();
      clearImageListeners();
      const current = ++selection;
      const previous = selected, wasLoaded = loaded;
      selected = chooseMoonShip(catalog, { random });
      progress = selected ? unitRandom(random) : 0;
      geometry = selected ? { tiltDegrees: unitRandom(random) * 360, direction: unitRandom(random) < 0.5 ? 1 : -1 }
        : { tiltDegrees: -15, direction: 1 };
      reroutePending = false;
      loaded = Boolean(selected && selected.href === previous?.href && wasLoaded);
      draw();
      if (!selected) { image.removeAttribute("href"); return null; }
      onLoad = () => {
        if (destroyed || current !== selection) return;
        loaded = true;
        refresh();
      };
      onError = () => {
        if (destroyed || current !== selection) return;
        loaded = false;
        refresh();
      };
      image.addEventListener("load", onLoad);
      image.addEventListener("error", onError);
      if (selected.href === previous?.href && !loaded) image.removeAttribute("href");
      image.setAttribute("href", selected.href);
      if (loaded) refresh(); // The browser need not emit load again for unchanged cached artwork.
      return selected;
    },
    pause() { if (!destroyed) { paused = true; refresh(); } },
    resume() { if (!destroyed) { paused = false; refresh(); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      selection += 1;
      stop();
      clearImageListeners();
      doc.removeEventListener("visibilitychange", onVisibility);
      view.removeEventListener?.("pagehide", onPageHide);
      view.removeEventListener?.("pageshow", onPageShow);
      motion?.removeEventListener?.("change", refresh);
      element.setAttribute("visibility", "hidden");
    },
  };
}
