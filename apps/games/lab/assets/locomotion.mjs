// Distances belong to the actor's full sprite canvas, never the camera zoom.
export const MACAW_CANVAS_WORLD_SIZE = 2.1;

export function walkingMetrics(profile, actorScale = 1) {
  if (!profile || ![profile.canvas_pixels, profile.frames_per_cycle, profile.steps_per_cycle,
    profile.fps, profile.stride_pixels, actorScale].every(value => Number.isFinite(value) && value > 0)
    || !Number.isInteger(profile.frames_per_cycle) || !Number.isInteger(profile.steps_per_cycle)) {
    throw new Error('Invalid walking calibration or actor scale.');
  }
  const canvasWorldSize = MACAW_CANVAS_WORLD_SIZE * actorScale;
  const cycleDistance = profile.stride_pixels / profile.canvas_pixels * canvasWorldSize;
  return {canvasWorldSize, cycleDistance, stepDistance: cycleDistance / profile.steps_per_cycle,
    frameDistance: cycleDistance / profile.frames_per_cycle,
    speed: cycleDistance * profile.fps / profile.frames_per_cycle};
}

export function advanceWalkingCycles(completedCycles, travelledDistance, metrics) {
  if (!Number.isFinite(completedCycles) || completedCycles < 0
    || !Number.isFinite(travelledDistance) || travelledDistance < 0
    || !Number.isFinite(metrics?.cycleDistance) || metrics.cycleDistance <= 0) {
    throw new Error('Invalid walking distance.');
  }
  return completedCycles + travelledDistance / metrics.cycleDistance;
}
