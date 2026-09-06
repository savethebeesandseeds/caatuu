// Preserve fractional animation time across requestAnimationFrame callbacks.
// A long inactive gap advances one pose, avoiding a burst of skipped poses.
export function animationTick(now, previous, fps) {
  const interval = 1000 / fps;
  const elapsed = now - previous;
  if (elapsed + 1e-7 < interval) return { advance: false, previous };
  const remainder = elapsed % interval;
  return { advance: true, previous: now - (remainder < interval - 1e-7 ? remainder : 0) };
}
