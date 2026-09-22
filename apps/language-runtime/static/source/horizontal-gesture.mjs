const CONTROL_SELECTOR = 'button, a, input, select, textarea, label, summary, dialog, [contenteditable], [draggable="true"], [role="button"], [role="link"], [role="slider"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"]';

// Ordinary controls retain browser click/keyboard activation. This owner is only
// for an explicitly opted-in play surface, with one release-based gesture.
export function bindHorizontalGesture({
  surface, document = surface?.ownerDocument, window = document?.defaultView,
  available = () => true, identity = () => null, onAction, onPreview = () => {},
  exclude = "", pointerTypes = null, capturePointer = false, edgeGutter = 36,
  minDistance = 64, maxVerticalRatio = 0.65, maxDurationMs = Infinity,
  verticalCancelDistance = 18, verticalCancelRatio = 1.15
}) {
  if (!surface || !document || !window) throw new TypeError("A gesture requires its surface, document, and window.");
  let gesture = null;
  let pendingClick = null;
  let disposed = false;
  const contacts = new Set();
  const disposers = [];
  const listen = (target, type, handler, options = true) => {
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  };
  const point = (event) => ({ x: Number(event.clientX), y: Number(event.clientY),
    time: Number(event.timeStamp ?? window.performance?.now?.() ?? Date.now()) });
  const currentIdentity = () => [].concat(identity());
  const stillCurrent = (start) => {
    const current = currentIdentity();
    return surface.isConnected !== false && available() && current.length === start.identity.length
      && current.every((value, index) => Object.is(value, start.identity[index]));
  };
  const reset = () => {
    const pointerId = gesture?.pointerId;
    gesture = null;
    onPreview(null);
    try {
      if (pointerId !== undefined && surface.hasPointerCapture?.(pointerId)) surface.releasePointerCapture(pointerId);
    } catch { /* Capture may already have been released by the browser. */ }
  };
  const direction = (start, end) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (![dx, dy, end.time].every(Number.isFinite) || Math.abs(dx) < start.distance
        || Math.abs(dy) > Math.abs(dx) * maxVerticalRatio
        || end.time < start.time || end.time - start.time > maxDurationMs) return null;
    return dx < 0 ? "left" : "right";
  };
  const cancel = () => { reset(); contacts.clear(); pendingClick = null; };

  // Listen outside the surface too: a second finger elsewhere still makes this
  // a multi-contact gesture. Capture observes controls that stop propagation.
  listen(document, "pointerdown", (event) => {
    pendingClick = null;
    const alreadyDown = contacts.size > 0;
    contacts.add(event.pointerId);
    if (gesture || alreadyDown || event.isPrimary === false) { reset(); return; }
    if (disposed || !available() || event.button > 0
        || (pointerTypes && !pointerTypes.includes(event.pointerType))
        || !surface.contains(event.target)
        || event.target?.closest?.(exclude ? `${CONTROL_SELECTOR}, ${exclude}` : CONTROL_SELECTOR)) return;
    const start = point(event);
    const width = Number(window.innerWidth);
    if (![start.x, start.y, start.time].every(Number.isFinite)
        || (width > 0 && (start.x <= edgeGutter || start.x >= width - edgeGutter))) return;
    gesture = { ...start, pointerId: event.pointerId, pointerType: event.pointerType,
      target: event.target, identity: currentIdentity(),
      distance: typeof minDistance === "function" ? minDistance() : minDistance };
    if (capturePointer) {
      try { surface.setPointerCapture?.(event.pointerId); }
      catch { /* A pointer can leave the document before capture is acquired. */ }
    }
  });
  listen(document, "pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const end = point(event);
    const dx = Math.abs(end.x - gesture.x);
    const dy = Math.abs(end.y - gesture.y);
    if (!stillCurrent(gesture) || (dy > verticalCancelDistance && dy > dx * verticalCancelRatio)) {
      reset(); return;
    }
    onPreview(direction(gesture, end));
  }, { capture: true, passive: true });
  listen(document, "pointerup", (event) => {
    contacts.delete(event.pointerId);
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const start = gesture;
    const end = point(event);
    const action = stillCurrent(start) ? direction(start, end) : null;
    reset();
    if (!action) return;
    // The ensuing compatibility click belongs to this pointer sequence only.
    // A new press clears this token; keyboard/programmatic clicks never use it.
    onAction(action);
    pendingClick = { pointerId: event.pointerId, target: event.target, startTarget: start.target, ...end };
  });
  listen(document, "pointercancel", (event) => {
    contacts.delete(event.pointerId);
    reset();
  });
  listen(surface, "lostpointercapture", reset);
  listen(document, "click", (event) => {
    const click = pendingClick;
    if (!click || event.detail === 0) return;
    pendingClick = null;
    const pointerMatches = event.pointerId !== undefined && event.pointerId > 0
      ? event.pointerId === click.pointerId
      : (event.target === click.target || event.target === click.startTarget || surface.contains(event.target))
        && Math.abs(Number(event.clientX) - click.x) <= 2 && Math.abs(Number(event.clientY) - click.y) <= 2;
    if (!pointerMatches) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  listen(window, "blur", cancel);
  listen(window, "pagehide", cancel);
  listen(document, "keydown", reset);
  listen(document, "scroll", reset);
  listen(document, "visibilitychange", () => {
    if (document.hidden || document.visibilityState === "hidden") cancel();
  });
  return Object.freeze({ cancel, dispose() {
    disposed = true;
    cancel();
    disposers.splice(0).forEach((dispose) => dispose());
  } });
}
