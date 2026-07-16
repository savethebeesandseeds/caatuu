import { LayeredCharacterRig } from "./character-rig.js?v=full-rig-3";

const WORLD = { width: 2200, height: 1500 };
const START = { x: 1110, y: 820 };
const actors = {
  human: {
    src: "./experimental/human-walk-imagegen-v1/idle/human-pose-idle_001.png?v=1",
    frameSets: {
      keyframes: {
        frames: [1, 3, 5, 6, 7, 9, 11, 10].map((frame) => `./experimental/human-walk-imagegen-v1/frames/human-pose-walk_${String(frame).padStart(3, "0")}.png?v=4`),
        phases: ["contact A", "17%", "33%", "42%", "contact B", "67%", "83%", "passing B"],
        playbackOrder: [0, 1, 2, 3, 4, 5, 6, 7],
        idle: "./experimental/human-walk-imagegen-v1/idle/human-pose-idle_001.png?v=1",
        idleFrames: Array.from({ length: 6 }, (_, index) => `./experimental/human-walk-imagegen-v1/idle/human-pose-idle_${String(index + 1).padStart(3, "0")}.png?v=1`),
        idleFrameDuration: 220,
        frameDistance: 32.083333,
      },
    },
    alt: "Human mocap reference with grayscale values assigned by depth",
    labels: {
      keyframes: "Human pose authority - curated eight-frame playback and review sequence",
    },
    facingSign: { left: 1, right: -1 },
  },
  macaw: {
    src: "/assets/macaw/walk/side/macaw-walk_005.png",
    frameSets: {
      guided: {
        frames: [1, 3, 5, 6, 7, 9, 11, 10].map((frame) => `./experimental/macaw-pose-guided-v1/frames/macaw-pose-walk_${String(frame).padStart(3, "0")}.png?v=1`),
        phases: ["contact A", "17%", "33%", "42%", "contact B", "67%", "83%", "passing B"],
        playbackOrder: [0, 1, 2, 3, 4, 5, 6, 7],
        idle: "./experimental/macaw-pose-guided-v1/frames/macaw-pose-walk_001.png?v=1",
        frameDistance: 32.083333,
      },
      keyframes: {
        frames: Array.from({ length: 8 }, (_, index) => `./experimental/macaw-walk-v4/frames/macaw-walk-v4_${String(index + 1).padStart(3, "0")}.png?v=2`),
        phases: ["contact A", "down A", "passing A", "up A", "contact B", "down B", "passing B", "up B"],
        idle: "/assets/character-rigs/macaw-traveler-v1/layers/neutral-reference.png?v=1",
        frameDistance: 26,
      },
      frames: {
        frames: Array.from({ length: 8 }, (_, index) => `/assets/macaw/walk/side/macaw-walk_${String(index + 1).padStart(3, "0")}.png`),
        phases: Array.from({ length: 8 }, (_, index) => `legacy ${index + 1}`),
        idleFrameIndex: 4,
        frameDistance: 16,
      },
    },
    alt: "Traveler macaw",
    labels: {
      full: "articulated full-body rig",
      rig: "controlled two-foot rig",
      guided: "Macaw v1 · generated individually from the approved human silhouette guides",
      keyframes: "Macaw V4 · mocap-guided eight-frame cycle",
      frames: "older generated eight-frame cycle",
    },
    facingSign: { left: 1, right: -1 },
  },
  robot: {
    src: "/assets/robots/robot%20(1).png",
    alt: "Gardener robot",
    label: "one standing pose",
    facingSign: { left: -1, right: 1 },
  },
};
const GAIT = {
  cycleDistance: 92,
  stride: 30,
  lift: 11,
  stanceFraction: .62,
  startDuration: 180,
  arrivalDuration: 360,
};
const objects = [
  { src: "/assets/miscellaneous/burrow-review_049.png", x: 420, y: 490, width: 330, alt: "Civic hall" },
  { src: "/assets/miscellaneous/burrow-review_051.png", x: 840, y: 455, width: 335, alt: "Library" },
  { src: "/assets/miscellaneous/burrow-review_057.png", x: 1510, y: 505, width: 320, alt: "Tea house" },
  { src: "/assets/miscellaneous/burrow-review_040.png", x: 310, y: 1040, width: 285, alt: "Town shade tree" },
  { src: "/assets/miscellaneous/burrow-review_053.png", x: 790, y: 1130, width: 300, alt: "Produce market" },
  { src: "/assets/miscellaneous/burrow-review_060.png", x: 1940, y: 850, width: 300, alt: "Waterworks" },
  { src: "/assets/miscellaneous/burrow-review_035.png", x: 1370, y: 1010, width: 185, alt: "Public bench" },
  { src: "/assets/miscellaneous/burrow-review_036.png", x: 1040, y: 650, width: 100, alt: "Street lamp" },
  { src: "/assets/miscellaneous/burrow-review_036.png", x: 1260, y: 1050, width: 100, alt: "Street lamp" },
  { src: "/assets/miscellaneous/burrow-review_047.png", x: 1560, y: 1180, width: 205, alt: "Food cart" },
  { src: "/assets/robots/robot%20(8).png", x: 610, y: 875, width: 112, alt: "Town helper robot" },
  { src: "/assets/robots/robot%20(17).png", x: 1725, y: 730, width: 112, alt: "Town helper robot" },
];

const lab = document.querySelector("#movementLab");
const viewport = document.querySelector("#viewport");
const world = document.querySelector("#world");
const actor = document.querySelector("#actor");
const actorImage = document.querySelector("#actorImage");
const actorRig = document.querySelector("#actorRig");
const actorSkeletalRig = document.querySelector("#actorSkeletalRig");
const actorShadow = document.querySelector("#actorShadow");
const destination = document.querySelector("#destination");
const positionReadout = document.querySelector("#positionReadout");
const facingReadout = document.querySelector("#facingReadout");
const motionReadout = document.querySelector("#motionReadout");
const assetReadout = document.querySelector("#assetReadout");
const speedControl = document.querySelector("#speedControl");
const speedOutput = document.querySelector("#speedOutput");
const cycleToggle = document.querySelector("#cycleToggle");
const holdFrameToggle = document.querySelector("#holdFrameToggle");
const frameControl = document.querySelector("#frameControl");
const frameOutput = document.querySelector("#frameOutput");
const cameraToggle = document.querySelector("#cameraToggle");
const diagnosticsToggle = document.querySelector("#diagnosticsToggle");
const animationModeFieldset = document.querySelector("#animationModeFieldset");

const state = {
  x: START.x,
  y: START.y,
  speed: Number(speedControl.value),
  facing: "right",
  actor: "human",
  animationMode: "keyframes",
  target: null,
  keys: new Set(),
  camera: { x: 0, y: 0 },
  lastTime: performance.now(),
  animationDistance: 0,
  frameIndex: 0,
  wasMoving: false,
  motion: "standing",
  motionChangedAt: performance.now(),
  arrivalPose: null,
  skeletalArrivalPose: null,
  skeletalPose: {},
  rigPose: {
    near: { x: 0, y: 0, rotation: 0 },
    far: { x: 0, y: 0, rotation: 0 },
  },
};

const skeletalRig = await LayeredCharacterRig.load(
  actorSkeletalRig,
  "/assets/character-rigs/macaw-traveler-v1/rig.json?v=5",
);
void skeletalRig.assetsReady().catch((error) => console.error(error));

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const smoothstep = (value) => value * value * (3 - 2 * value);
const easeOutCubic = (value) => 1 - (1 - value) ** 3;

function neutralRigPose() {
  return {
    near: { x: 0, y: 0, rotation: 0 },
    far: { x: 0, y: 0, rotation: 0 },
  };
}

function copyRigPose(pose) {
  return {
    near: { ...pose.near },
    far: { ...pose.far },
  };
}

function blendFootPose(from, to, amount) {
  return {
    x: lerp(from.x, to.x, amount),
    y: lerp(from.y, to.y, amount),
    rotation: lerp(from.rotation, to.rotation, amount),
  };
}

function blendRigPose(from, to, amount) {
  return {
    near: blendFootPose(from.near, to.near, amount),
    far: blendFootPose(from.far, to.far, amount),
  };
}

function copySkeletalPose(pose) {
  return Object.fromEntries(Object.entries(pose).map(([bone, transform]) => [bone, { ...transform }]));
}

function blendSkeletalPose(from, to, amount) {
  const pose = {};
  const bones = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const bone of bones) {
    const start = from[bone] || {};
    const end = to[bone] || {};
    pose[bone] = {
      x: lerp(start.x ?? 0, end.x ?? 0, amount),
      y: lerp(start.y ?? 0, end.y ?? 0, amount),
      rotation: lerp(start.rotation ?? 0, end.rotation ?? 0, amount),
      scaleX: lerp(start.scaleX ?? 1, end.scaleX ?? 1, amount),
      scaleY: lerp(start.scaleY ?? 1, end.scaleY ?? 1, amount),
    };
  }
  return pose;
}

function footTrajectory(rawPhase) {
  const phase = ((rawPhase % 1) + 1) % 1;
  const halfStride = GAIT.stride / 2;
  if (phase < GAIT.stanceFraction) {
    const progress = phase / GAIT.stanceFraction;
    return {
      // The source drawing faces left. Advancing from -stride to +stride
      // cancels the actor's world movement while this foot supports the body;
      // the facing mirror reverses the same trajectory for rightward travel.
      x: lerp(-halfStride, halfStride, progress),
      y: 0,
      rotation: lerp(-3, 4, progress),
    };
  }
  const progress = (phase - GAIT.stanceFraction) / (1 - GAIT.stanceFraction);
  const eased = smoothstep(progress);
  return {
    x: lerp(halfStride, -halfStride, eased),
    y: -Math.sin(progress * Math.PI) * GAIT.lift,
    rotation: lerp(4, -5, eased),
  };
}

function walkingRigPose() {
  const phase = (state.animationDistance / GAIT.cycleDistance) % 1;
  return {
    near: footTrajectory(phase),
    far: footTrajectory(phase + .5),
  };
}

function walkingSkeletalPose() {
  const phase = (state.animationDistance / GAIT.cycleDistance) % 1;
  const near = footTrajectory(phase);
  const far = footTrajectory(phase + .5);
  const pose = skeletalRig.poseAtClip("walking", phase);
  pose.leg_near_lower = { x: near.x, y: near.y, rotation: near.rotation * 1.25 };
  pose.leg_far_lower = { x: far.x, y: far.y, rotation: far.rotation * 1.25 };
  return pose;
}

function landingRigPose() {
  return {
    near: { x: -3, y: 0, rotation: -2 },
    far: { x: 4, y: 0, rotation: 2.5 },
  };
}

function landingSkeletalPose() {
  return skeletalRig.poseAtClip("arriving", 0);
}

function applyRigPose(pose) {
  actorRig.style.setProperty("--near-x", `${pose.near.x.toFixed(2)}px`);
  actorRig.style.setProperty("--near-y", `${pose.near.y.toFixed(2)}px`);
  actorRig.style.setProperty("--near-rotation", `${pose.near.rotation.toFixed(2)}deg`);
  actorRig.style.setProperty("--far-x", `${pose.far.x.toFixed(2)}px`);
  actorRig.style.setProperty("--far-y", `${pose.far.y.toFixed(2)}px`);
  actorRig.style.setProperty("--far-rotation", `${pose.far.rotation.toFixed(2)}deg`);
}

function updateMotionState(moving, now) {
  if (moving && !state.wasMoving) {
    state.animationDistance = 0;
    state.frameIndex = 0;
    state.motion = "starting";
    state.motionChangedAt = now;
  } else if (!moving && state.wasMoving) {
    state.motion = "arriving";
    state.motionChangedAt = now;
    state.arrivalPose = copyRigPose(state.rigPose);
    state.skeletalArrivalPose = copySkeletalPose(state.skeletalPose);
  }

  if (moving) {
    const walkingPose = walkingRigPose();
    const walkingSkeleton = walkingSkeletalPose();
    if (state.motion === "starting") {
      const progress = clamp01((now - state.motionChangedAt) / GAIT.startDuration);
      const eased = smoothstep(progress);
      state.rigPose = blendRigPose(neutralRigPose(), walkingPose, eased);
      state.skeletalPose = blendSkeletalPose({}, walkingSkeleton, eased);
      if (progress >= 1) state.motion = "walking";
    } else {
      state.motion = "walking";
      state.rigPose = walkingPose;
      state.skeletalPose = walkingSkeleton;
    }
  } else if (state.motion === "arriving") {
    const progress = clamp01((now - state.motionChangedAt) / GAIT.arrivalDuration);
    const impactEnd = .42;
    if (progress < impactEnd) {
      const impact = easeOutCubic(progress / impactEnd);
      state.rigPose = blendRigPose(state.arrivalPose || neutralRigPose(), landingRigPose(), impact);
      state.skeletalPose = blendSkeletalPose(state.skeletalArrivalPose || {}, landingSkeletalPose(), impact);
    } else {
      const recovery = smoothstep((progress - impactEnd) / (1 - impactEnd));
      state.rigPose = blendRigPose(landingRigPose(), neutralRigPose(), recovery);
      state.skeletalPose = blendSkeletalPose(landingSkeletalPose(), {}, recovery);
    }
    if (progress >= 1) {
      state.motion = "standing";
      state.rigPose = neutralRigPose();
      state.skeletalPose = {};
      state.arrivalPose = null;
      state.skeletalArrivalPose = null;
    }
  } else {
    state.motion = "standing";
    state.rigPose = neutralRigPose();
    state.skeletalPose = {};
  }

  state.wasMoving = moving;
  applyRigPose(state.rigPose);
  skeletalRig.setPose(state.skeletalPose);
  const spread = Math.abs(state.rigPose.near.x - state.rigPose.far.x);
  actorShadow.style.setProperty("--shadow-scale", String(1 + Math.min(.12, spread / 220)));
}

function buildWorldObjects() {
  const fragment = document.createDocumentFragment();
  for (const item of objects) {
    const wrapper = document.createElement("div");
    wrapper.className = "world-object";
    wrapper.style.setProperty("--x", `${item.x}px`);
    wrapper.style.setProperty("--y", `${item.y}px`);
    wrapper.style.setProperty("--width", `${item.width}px`);
    wrapper.style.zIndex = String(Math.round(item.y));
    const image = document.createElement("img");
    image.src = item.src;
    image.alt = item.alt;
    image.loading = "eager";
    image.draggable = false;
    const anchor = document.createElement("span");
    anchor.className = "anchor-dot";
    wrapper.append(image, anchor);
    fragment.append(wrapper);
  }
  world.insertBefore(fragment, actor);
}

function movementVector() {
  let x = 0;
  let y = 0;
  if (state.keys.has("left")) x -= 1;
  if (state.keys.has("right")) x += 1;
  if (state.keys.has("up")) y -= 1;
  if (state.keys.has("down")) y += 1;
  if (x || y) {
    state.target = null;
    destination.hidden = true;
    const length = Math.hypot(x, y);
    return { x: x / length, y: y / length };
  }
  if (!state.target) return { x: 0, y: 0 };
  const dx = state.target.x - state.x;
  const dy = state.target.y - state.y;
  const length = Math.hypot(dx, dy);
  if (length < 5) {
    state.target = null;
    destination.hidden = true;
    return { x: 0, y: 0 };
  }
  return { x: dx / length, y: dy / length, remaining: length };
}

function updateCamera(immediate = false) {
  const bounds = viewport.getBoundingClientRect();
  const desiredX = Math.min(0, Math.max(bounds.width - WORLD.width, bounds.width * .5 - state.x));
  const desiredY = Math.min(0, Math.max(bounds.height - WORLD.height, bounds.height * .56 - state.y));
  if (cameraToggle.checked || immediate) {
    const strength = immediate ? 1 : .12;
    state.camera.x += (desiredX - state.camera.x) * strength;
    state.camera.y += (desiredY - state.camera.y) * strength;
  }
  world.style.transform = `translate3d(${state.camera.x}px, ${state.camera.y}px, 0)`;
}

function render(moving, previewing = false, reviewing = false) {
  const profile = actors[state.actor];
  const useFullRig = state.actor === "macaw" && state.animationMode === "full";
  const useRig = state.actor === "macaw" && state.animationMode === "rig";
  const frameSet = profile.frameSets?.[state.animationMode];
  const frameIndex = frameSet?.frames?.length ? state.frameIndex % frameSet.frames.length : 0;
  const showingCycle = moving || previewing || reviewing;
  const idleFrames = frameSet?.idleFrames || [];
  const idleFrameIndex = idleFrames.length
    ? Math.floor(performance.now() / (frameSet.idleFrameDuration || 220)) % idleFrames.length
    : 0;
  const frameSource = showingCycle
    ? (frameSet?.frames?.[frameIndex] || profile.src)
    : (state.motion === "standing" && idleFrames.length
      ? idleFrames[idleFrameIndex]
      : (frameSet?.idle || frameSet?.frames?.[frameSet.idleFrameIndex ?? 0] || profile.src));
  actorSkeletalRig.hidden = !useFullRig;
  actorRig.hidden = !useRig;
  actorImage.hidden = useFullRig || useRig;
  if (!useFullRig && !useRig && actorImage.getAttribute("src") !== frameSource) actorImage.src = frameSource;
  actor.style.setProperty("--x", `${state.x}px`);
  actor.style.setProperty("--y", `${state.y}px`);
  actor.style.setProperty("--facing", profile.facingSign[state.facing]);
  actor.style.zIndex = String(Math.round(state.y));
  actor.classList.toggle("is-moving", showingCycle);
  actor.classList.toggle("is-rig", useFullRig || useRig);
  actor.dataset.motion = state.motion;
  positionReadout.textContent = `${Math.round(state.x)}, ${Math.round(state.y)}`;
  facingReadout.textContent = state.facing;
  motionReadout.textContent = reviewing ? "frame review" : previewing ? "cycle preview" : state.motion;
  assetReadout.textContent = profile.labels?.[state.animationMode] || profile.label;
  syncFrameReview(frameSet);
}

function syncFrameReview(frameSet = actors[state.actor].frameSets?.[state.animationMode]) {
  const frameCount = frameSet?.frames?.length || 1;
  const frameIndex = Math.min(state.frameIndex, frameCount - 1);
  frameControl.max = String(frameCount);
  frameControl.value = String(frameIndex + 1);
  frameControl.disabled = !frameSet;
  holdFrameToggle.disabled = frameControl.disabled;
  const phase = frameSet?.phases?.[frameIndex];
  frameOutput.value = `${frameIndex + 1} / ${frameCount}${phase ? ` · ${phase}` : ""}`;
}

function frame(now) {
  const elapsed = Math.min(.04, (now - state.lastTime) / 1000);
  state.lastTime = now;
  const vector = movementVector();
  const moving = Boolean(vector.x || vector.y);
  if (moving) {
    const distance = Math.min(state.speed * elapsed, vector.remaining ?? Infinity);
    state.x = Math.min(WORLD.width - 45, Math.max(45, state.x + vector.x * distance));
    state.y = Math.min(WORLD.height - 35, Math.max(120, state.y + vector.y * distance));
    if (Math.abs(vector.x) > .08) state.facing = vector.x < 0 ? "left" : "right";
    if (actors[state.actor].frameSets) advanceActorAnimation(distance);
  }
  const previewing = cycleToggle.checked
    && Boolean(actors[state.actor].frameSets?.[state.animationMode]);
  const reviewing = holdFrameToggle.checked
    && !moving
    && Boolean(actors[state.actor].frameSets?.[state.animationMode]);
  if (previewing && !moving && !reviewing) advanceActorAnimation(state.speed * elapsed);
  updateMotionState(moving, now);
  updateCamera();
  render(moving, previewing && !moving, reviewing && !moving);
  requestAnimationFrame(frame);
}

function advanceActorAnimation(distance) {
  state.animationDistance += distance;
  const frameSet = actors[state.actor].frameSets?.[state.animationMode];
  if (frameSet?.frames.length) {
    const playbackOrder = frameSet.playbackOrder || frameSet.frames.map((_, index) => index);
    const playbackIndex = Math.floor(state.animationDistance / frameSet.frameDistance) % playbackOrder.length;
    state.frameIndex = playbackOrder[playbackIndex];
  }
}

function worldPoint(event) {
  const bounds = viewport.getBoundingClientRect();
  return {
    x: Math.min(WORLD.width - 45, Math.max(45, event.clientX - bounds.left - state.camera.x)),
    y: Math.min(WORLD.height - 35, Math.max(120, event.clientY - bounds.top - state.camera.y)),
  };
}

viewport.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button, input, .control-panel")) return;
  state.target = worldPoint(event);
  destination.style.setProperty("--x", `${state.target.x}px`);
  destination.style.setProperty("--y", `${state.target.y}px`);
  destination.style.zIndex = String(Math.round(state.target.y - 1));
  destination.hidden = false;
});

const keyDirections = new Map([
  ["arrowup", "up"], ["w", "up"],
  ["arrowdown", "down"], ["s", "down"],
  ["arrowleft", "left"], ["a", "left"],
  ["arrowright", "right"], ["d", "right"],
]);

window.addEventListener("keydown", (event) => {
  const direction = keyDirections.get(event.key.toLowerCase());
  if (!direction) return;
  event.preventDefault();
  state.keys.add(direction);
});
window.addEventListener("keyup", (event) => {
  const direction = keyDirections.get(event.key.toLowerCase());
  if (direction) state.keys.delete(direction);
});
window.addEventListener("blur", () => state.keys.clear());

for (const button of document.querySelectorAll("[data-move]")) {
  const direction = button.dataset.move;
  const stop = () => state.keys.delete(direction);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    state.keys.add(direction);
  });
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
}

for (const button of document.querySelectorAll("[data-actor]")) {
  button.addEventListener("click", () => {
    state.actor = button.dataset.actor;
    const profile = actors[state.actor];
    actor.dataset.kind = state.actor;
    actorImage.src = profile.src;
    actorImage.alt = profile.alt;
    if (!profile.frameSets?.[state.animationMode]) state.animationMode = "keyframes";
    animationModeFieldset.disabled = !profile.frameSets;
    document.querySelectorAll("[data-macaw-only]").forEach((candidate) => {
      candidate.hidden = state.actor !== "macaw";
    });
    document.querySelectorAll("[data-animation-mode]").forEach((candidate) => {
      candidate.classList.toggle("is-active", candidate.dataset.animationMode === state.animationMode);
    });
    state.animationDistance = 0;
    state.frameIndex = 0;
    state.motion = state.wasMoving ? "starting" : "standing";
    state.motionChangedAt = performance.now();
    state.rigPose = neutralRigPose();
    state.skeletalPose = {};
    applyRigPose(state.rigPose);
    skeletalRig.setPose(state.skeletalPose);
    document.querySelectorAll("[data-actor]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    render(state.wasMoving);
  });
}

for (const button of document.querySelectorAll("[data-animation-mode]")) {
  button.addEventListener("click", () => {
    if (!actors[state.actor].frameSets?.[button.dataset.animationMode]) return;
    state.animationMode = button.dataset.animationMode;
    state.animationDistance = 0;
    state.frameIndex = 0;
    state.motion = state.wasMoving ? "starting" : "standing";
    state.motionChangedAt = performance.now();
    state.rigPose = neutralRigPose();
    state.skeletalPose = {};
    applyRigPose(state.rigPose);
    skeletalRig.setPose(state.skeletalPose);
    document.querySelectorAll("[data-animation-mode]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    render(state.wasMoving);
  });
}

speedControl.addEventListener("input", () => {
  state.speed = Number(speedControl.value);
  speedOutput.value = speedControl.value;
});
frameControl.addEventListener("input", () => {
  const frameSet = actors[state.actor].frameSets?.[state.animationMode];
  if (!frameSet?.frames.length) return;
  state.frameIndex = Number(frameControl.value) - 1;
  state.animationDistance = state.frameIndex * frameSet.frameDistance;
  render(false, false, true);
});
diagnosticsToggle.addEventListener("change", () => lab.classList.toggle("is-diagnostic", diagnosticsToggle.checked));
document.querySelector("#resetButton").addEventListener("click", () => {
  state.x = START.x;
  state.y = START.y;
  state.target = null;
  state.keys.clear();
  destination.hidden = true;
  state.wasMoving = false;
  state.motion = "standing";
  state.animationDistance = 0;
  state.frameIndex = 0;
  state.rigPose = neutralRigPose();
  state.skeletalPose = {};
  applyRigPose(state.rigPose);
  skeletalRig.setPose(state.skeletalPose);
  updateCamera(true);
  render(false);
});
window.addEventListener("resize", () => updateCamera(true));

buildWorldObjects();
document.querySelectorAll("[data-macaw-only]").forEach((candidate) => {
  candidate.hidden = state.actor !== "macaw";
});
for (const profile of Object.values(actors)) {
  for (const frameSet of Object.values(profile.frameSets || {})) {
    for (const frame of frameSet.frames) {
      const image = new Image();
      image.src = frame;
    }
    for (const frame of frameSet.idleFrames || []) {
      const image = new Image();
      image.src = frame;
    }
    if (frameSet.idle) {
      const image = new Image();
      image.src = frameSet.idle;
    }
  }
}
applyRigPose(state.rigPose);
updateCamera(true);
render(false);
requestAnimationFrame(frame);
