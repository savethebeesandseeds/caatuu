const SOURCE_URL = "./source/AnimationLibrary_Godot_Standard.glb";
const CLIP_SETS = [
  { name: "Idle_Loop", title: "Standing / idle", frames: 6, columns: 3 },
  { name: "Walk_Loop", title: "Natural walk", frames: 12, columns: 4 },
  { name: "Sprint_Loop", title: "Run / sprint", frames: 12, columns: 4 },
];
const KEY_BONES = [
  "DEF-head", "DEF-neck", "DEF-spine.003", "DEF-spine.001", "DEF-hips",
  "DEF-upper_arm.L", "DEF-forearm.L", "DEF-hand.L",
  "DEF-upper_arm.R", "DEF-forearm.R", "DEF-hand.R",
  "DEF-thigh.L", "DEF-shin.L", "DEF-foot.L", "DEF-toe.L",
  "DEF-thigh.R", "DEF-shin.R", "DEF-foot.R", "DEF-toe.R",
];
const BONE_LINKS = [
  ["DEF-hips", "DEF-spine.001"], ["DEF-spine.001", "DEF-spine.003"], ["DEF-spine.003", "DEF-neck"], ["DEF-neck", "DEF-head"],
  ["DEF-spine.003", "DEF-upper_arm.L"], ["DEF-upper_arm.L", "DEF-forearm.L"], ["DEF-forearm.L", "DEF-hand.L"],
  ["DEF-spine.003", "DEF-upper_arm.R"], ["DEF-upper_arm.R", "DEF-forearm.R"], ["DEF-forearm.R", "DEF-hand.R"],
  ["DEF-hips", "DEF-thigh.L"], ["DEF-thigh.L", "DEF-shin.L"], ["DEF-shin.L", "DEF-foot.L"], ["DEF-foot.L", "DEF-toe.L"],
  ["DEF-hips", "DEF-thigh.R"], ["DEF-thigh.R", "DEF-shin.R"], ["DEF-shin.R", "DEF-foot.R"], ["DEF-foot.R", "DEF-toe.R"],
];
const LIMB_GUIDES = {
  left: [
    ["DEF-upper_arm.L", "DEF-forearm.L"], ["DEF-forearm.L", "DEF-hand.L"],
    ["DEF-thigh.L", "DEF-shin.L"], ["DEF-shin.L", "DEF-foot.L"], ["DEF-foot.L", "DEF-toe.L"],
  ],
  right: [
    ["DEF-upper_arm.R", "DEF-forearm.R"], ["DEF-forearm.R", "DEF-hand.R"],
    ["DEF-thigh.R", "DEF-shin.R"], ["DEF-shin.R", "DEF-foot.R"], ["DEF-foot.R", "DEF-toe.R"],
  ],
};
const LIMB_JOINTS = {
  left: ["DEF-forearm.L", "DEF-hand.L", "DEF-shin.L", "DEF-foot.L"],
  right: ["DEF-forearm.R", "DEF-hand.R", "DEF-shin.R", "DEF-foot.R"],
};
const GUIDE_STYLES = {
  presentation: {
    near: { color: "#f0caa7", width: 3.25, radius: 2.7 },
    far: { color: "#b8d6d3", width: 2.25, radius: 2.05 },
  },
  asset: {
    near: { color: "#355b59", width: 3.25, radius: 2.7 },
    far: { color: "#75523c", width: 2.25, radius: 2.05 },
  },
};
const SILHOUETTE_COLORS = { presentation: 0x111513, asset: 0x929292 };
const POSE_REGION_SEGMENTS = {
  left: [
    { part: "arm", from: "DEF-upper_arm.L", to: "DEF-forearm.L", radius: 5.6 },
    { part: "arm", from: "DEF-forearm.L", to: "DEF-hand.L", radius: 4.8 },
    { part: "leg", from: "DEF-thigh.L", to: "DEF-shin.L", radius: 8.8 },
    { part: "leg", from: "DEF-shin.L", to: "DEF-foot.L", radius: 6.8 },
    { part: "leg", from: "DEF-foot.L", to: "DEF-toe.L", radius: 4.6 },
  ],
  right: [
    { part: "arm", from: "DEF-upper_arm.R", to: "DEF-forearm.R", radius: 5.6 },
    { part: "arm", from: "DEF-forearm.R", to: "DEF-hand.R", radius: 4.8 },
    { part: "leg", from: "DEF-thigh.R", to: "DEF-shin.R", radius: 8.8 },
    { part: "leg", from: "DEF-shin.R", to: "DEF-foot.R", radius: 6.8 },
    { part: "leg", from: "DEF-foot.R", to: "DEF-toe.R", radius: 4.6 },
  ],
};
const POSE_REGION_STYLES = {
  farLeg: { fill: "#686868", zLevel: 0 },
  farArm: { fill: "#7e7e7e", zLevel: 1 },
  core: { fill: "#9f9f9f", zLevel: 2 },
  nearLeg: { fill: "#bdbdbd", zLevel: 3 },
  nearArm: { fill: "#dddddd", zLevel: 4 },
};
const POSE_CORE_REGIONS = [
  { from: "DEF-spine.003", to: "DEF-hips", radius: 15.0, style: "core" },
  { from: "DEF-neck", to: "DEF-head", radius: 16.0, style: "core" },
  // These clipped bridges close the small base-color wedges that otherwise
  // remain where the rig's torso meets its shoulders and pelvis. Near limbs
  // are painted afterwards, so the bridge never breaks the depth ordering.
  { from: "DEF-spine.003", to: "DEF-upper_arm.L", radius: 10.5, style: "core" },
  { from: "DEF-spine.003", to: "DEF-upper_arm.R", radius: 10.5, style: "core" },
  { from: "DEF-hips", to: "DEF-thigh.L", radius: 9.5, style: "core" },
  { from: "DEF-hips", to: "DEF-thigh.R", radius: 9.5, style: "core" },
];
const POSE_HANDS = {
  left: { forearm: "DEF-forearm.L", hand: "DEF-hand.L", radiusX: 6.2, radiusY: 3.8, extension: 2.2 },
  right: { forearm: "DEF-forearm.R", hand: "DEF-hand.R", radiusX: 6.2, radiusY: 3.8, extension: 2.2 },
};
const POSE_REGION_OVERLAP = 1.8;

const canvas = document.querySelector("#stageCanvas");
const stageWrap = document.querySelector("#stageWrap");
const status = document.querySelector("#status");
const playButton = document.querySelector("#playButton");
const phaseControl = document.querySelector("#phaseControl");
const phaseOutput = document.querySelector("#phaseOutput");
const clipSelect = document.querySelector("#clipSelect");
const jointToggle = document.querySelector("#jointToggle");
const clipReadout = document.querySelector("#clipReadout");
const durationReadout = document.querySelector("#durationReadout");
const channelReadout = document.querySelector("#channelReadout");
const referenceSets = document.querySelector("#referenceSets");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0xfffdf7, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);
const ground = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 0, 0)]),
  new THREE.LineBasicMaterial({ color: 0xa8a195 }),
);
scene.add(ground);

const jointGeometry = new THREE.BufferGeometry();
jointGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(KEY_BONES.length * 3), 3));
const jointPoints = new THREE.Points(jointGeometry, new THREE.PointsMaterial({ color: 0xe45d43, size: 7, sizeAttenuation: false, depthTest: false }));
jointPoints.renderOrder = 20;
scene.add(jointPoints);

const linkGeometry = new THREE.BufferGeometry();
linkGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BONE_LINKS.length * 6), 3));
const boneLines = new THREE.LineSegments(linkGeometry, new THREE.LineBasicMaterial({ color: 0x16898a, depthTest: false, transparent: true, opacity: .82 }));
boneLines.renderOrder = 19;
scene.add(boneLines);

let model;
let clips = new Map();
let activeClip;
let phase = 0;
let playing = false;
let lastFrameTime = performance.now();
let viewHeight = 2;
let viewCenter = new THREE.Vector3();
const boneObjects = new Map();
const silhouetteMaterials = [];
const sampledTracks = new WeakMap();
const tempPosition = new THREE.Vector3();
const guidePosition = new THREE.Vector3();

function setStatus(message, type = "") {
  status.textContent = message;
  status.classList.toggle("is-ready", type === "ready");
  status.classList.toggle("is-error", type === "error");
}

function setClip(name, nextPhase = 0) {
  const clip = clips.get(name);
  if (!clip) throw new Error(`Motion clip not found: ${name}`);
  activeClip = clip;
  phase = ((nextPhase % 1) + 1) % 1;
  clipSelect.value = name;
  clipReadout.textContent = name;
  durationReadout.textContent = `${clip.duration.toFixed(3)} s`;
  channelReadout.textContent = String(clip.tracks.length);
  updatePose();
}

function getSampledTracks(clip) {
  if (sampledTracks.has(clip)) return sampledTracks.get(clip);
  const bindings = clip.tracks.map((track) => {
    const propertySeparator = track.name.lastIndexOf(".");
    const nodeName = track.name.slice(0, propertySeparator);
    const propertyName = track.name.slice(propertySeparator + 1);
    const target = model.getObjectByName(nodeName);
    if (!target || !target[propertyName]?.fromArray) return null;
    const result = new Float32Array(track.getValueSize());
    return {
      target,
      propertyName,
      interpolant: track.createInterpolant(result),
    };
  }).filter(Boolean);
  sampledTracks.set(clip, bindings);
  return bindings;
}

function sampleClip(clip, sampleTime) {
  for (const binding of getSampledTracks(clip)) {
    const value = binding.interpolant.evaluate(sampleTime);
    binding.target[binding.propertyName].fromArray(value);
    if (binding.propertyName === "quaternion") binding.target.quaternion.normalize();
  }
}

function updatePose() {
  if (!model || !activeClip) return;
  const sampleTime = phase * activeClip.duration;
  sampleClip(activeClip, sampleTime);
  model.updateMatrixWorld(true);
  updateSkeletonOverlay();
  phaseControl.value = String(phase);
  phaseOutput.value = `${(phase * 100).toFixed(1)}%`;
  renderer.render(scene, camera);
}

function updateSkeletonOverlay() {
  const positions = jointGeometry.attributes.position.array;
  KEY_BONES.forEach((name, index) => {
    const bone = boneObjects.get(THREE.PropertyBinding.sanitizeNodeName(name));
    if (!bone) return;
    bone.getWorldPosition(tempPosition);
    positions[index * 3] = tempPosition.x;
    positions[index * 3 + 1] = tempPosition.y;
    positions[index * 3 + 2] = tempPosition.z;
  });
  jointGeometry.attributes.position.needsUpdate = true;

  const links = linkGeometry.attributes.position.array;
  BONE_LINKS.forEach(([fromName, toName], index) => {
    const from = boneObjects.get(THREE.PropertyBinding.sanitizeNodeName(fromName));
    const to = boneObjects.get(THREE.PropertyBinding.sanitizeNodeName(toName));
    if (!from || !to) return;
    from.getWorldPosition(tempPosition);
    links[index * 6] = tempPosition.x;
    links[index * 6 + 1] = tempPosition.y;
    links[index * 6 + 2] = tempPosition.z;
    to.getWorldPosition(tempPosition);
    links[index * 6 + 3] = tempPosition.x;
    links[index * 6 + 4] = tempPosition.y;
    links[index * 6 + 5] = tempPosition.z;
  });
  linkGeometry.attributes.position.needsUpdate = true;
}

function frameModel() {
  model.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(model);
  model.position.y -= initialBox.min.y;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  box.getCenter(viewCenter);
  const size = box.getSize(new THREE.Vector3());
  viewHeight = Math.max(size.y * 1.18, 1.6);
  // The source character faces along its local Z axis. Looking down X gives us
  // the strict lateral view needed to judge foot contact and limb arcs.
  camera.position.set(viewCenter.x + Math.max(size.x, size.z, 1) * 4, viewCenter.y, viewCenter.z);
  camera.lookAt(viewCenter);
  camera.updateProjectionMatrix();
  ground.position.x = viewCenter.x;
  ground.position.z = viewCenter.z;
  ground.geometry.dispose();
  ground.geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, -viewHeight),
    new THREE.Vector3(0, 0, viewHeight),
  ]);
  resizeRenderer();
}

function resizeRenderer() {
  const width = Math.max(1, Math.round(stageWrap.clientWidth));
  const height = Math.max(1, Math.round(stageWrap.clientHeight));
  const aspect = width / height;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  updatePose();
}

function canonicalLabel(clipName, index, count) {
  const phaseValue = index / count;
  if (clipName === "Idle_Loop") return `idle ${Math.round(phaseValue * 100)}%`;
  if (Math.abs(phaseValue - 0) < .001) return "contact A";
  if (Math.abs(phaseValue - .25) < .001) return "passing A";
  if (Math.abs(phaseValue - .5) < .001) return "contact B";
  if (Math.abs(phaseValue - .75) < .001) return "passing B";
  return `${Math.round(phaseValue * 100)}%`;
}

function projectedBone(name, x, y, width, height) {
  const bone = boneObjects.get(THREE.PropertyBinding.sanitizeNodeName(name));
  if (!bone) return null;
  bone.getWorldPosition(guidePosition);
  guidePosition.project(camera);
  return {
    x: x + (guidePosition.x * .5 + .5) * width,
    y: y + (-guidePosition.y * .5 + .5) * height,
  };
}

function sideDepth(side) {
  const names = side === "left"
    ? ["DEF-hand.L", "DEF-shin.L", "DEF-foot.L"]
    : ["DEF-hand.R", "DEF-shin.R", "DEF-foot.R"];
  let total = 0;
  let count = 0;
  for (const name of names) {
    const bone = boneObjects.get(THREE.PropertyBinding.sanitizeNodeName(name));
    if (!bone) continue;
    bone.getWorldPosition(guidePosition);
    total += camera.position.distanceToSquared(guidePosition);
    count += 1;
  }
  return count ? total / count : Infinity;
}

function drawGuideSide(context, side, style, x, y, width, height) {
  context.save();
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  context.lineWidth = style.width;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const [fromName, toName] of LIMB_GUIDES[side]) {
    const from = projectedBone(fromName, x, y, width, height);
    const to = projectedBone(toName, x, y, width, height);
    if (!from || !to) continue;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  for (const name of LIMB_JOINTS[side]) {
    const point = projectedBone(name, x, y, width, height);
    if (!point) continue;
    context.beginPath();
    context.arc(point.x, point.y, style.radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawLimbGuides(context, x, y, width, height, styles = GUIDE_STYLES.presentation) {
  const leftIsNear = sideDepth("left") <= sideDepth("right");
  const farSide = leftIsNear ? "right" : "left";
  const nearSide = leftIsNear ? "left" : "right";
  drawGuideSide(context, farSide, styles.far, x, y, width, height);
  drawGuideSide(context, nearSide, styles.near, x, y, width, height);
}

function drawPoseHand(context, side, style, x, y, width, height) {
  const handGuide = POSE_HANDS[side];
  const forearm = projectedBone(handGuide.forearm, x, y, width, height);
  const hand = projectedBone(handGuide.hand, x, y, width, height);
  if (!forearm || !hand) return;
  const angle = Math.atan2(hand.y - forearm.y, hand.x - forearm.x);
  const handX = hand.x + Math.cos(angle) * handGuide.extension;
  const handY = hand.y + Math.sin(angle) * handGuide.extension;
  context.beginPath();
  context.ellipse(handX, handY, handGuide.radiusX, handGuide.radiusY, angle, 0, Math.PI * 2);
  context.fillStyle = style.fill;
  context.fill();
}

function drawPoseRegionSide(context, side, style, part, x, y, width, height) {
  context.save();
  context.globalCompositeOperation = "source-atop";
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const segment of POSE_REGION_SEGMENTS[side].filter((candidate) => candidate.part === part)) {
    const from = projectedBone(segment.from, x, y, width, height);
    const to = projectedBone(segment.to, x, y, width, height);
    if (!from || !to) continue;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = style.fill;
    context.lineWidth = segment.radius * 2 + POSE_REGION_OVERLAP;
    context.stroke();
  }
  if (part === "arm") drawPoseHand(context, side, style, x, y, width, height);
  context.restore();
}

function drawPoseCoreRegions(context, x, y, width, height) {
  context.save();
  context.globalCompositeOperation = "source-atop";
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const region of POSE_CORE_REGIONS) {
    const from = projectedBone(region.from, x, y, width, height);
    const to = projectedBone(region.to, x, y, width, height);
    if (!from || !to) continue;
    const style = POSE_REGION_STYLES[region.style];
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = style.fill;
    context.lineWidth = region.radius * 2 + POSE_REGION_OVERLAP;
    context.stroke();
  }
  context.restore();
}

function drawPoseRegions(context, x, y, width, height) {
  const leftIsNear = sideDepth("left") <= sideDepth("right");
  const farSide = leftIsNear ? "right" : "left";
  const nearSide = leftIsNear ? "left" : "right";
  // Paint strictly from low to high depth. A hand is rendered only in its
  // arm pass, so it inherits that limb's z-level and can be naturally
  // occluded by every higher layer.
  drawPoseRegionSide(context, farSide, POSE_REGION_STYLES.farLeg, "leg", x, y, width, height);
  drawPoseRegionSide(context, farSide, POSE_REGION_STYLES.farArm, "arm", x, y, width, height);
  drawPoseCoreRegions(context, x, y, width, height);
  drawPoseRegionSide(context, nearSide, POSE_REGION_STYLES.nearLeg, "leg", x, y, width, height);
  drawPoseRegionSide(context, nearSide, POSE_REGION_STYLES.nearArm, "arm", x, y, width, height);
}

function setSilhouetteColor(color) {
  for (const material of silhouetteMaterials) material.color.setHex(color);
}

function downloadCanvas(sheetCanvas, filename) {
  sheetCanvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png");
}

function createSheet(set) {
  const clip = clips.get(set.name);
  if (!clip) return null;
  const card = document.createElement("article");
  card.className = "sheet-card";
  card.id = `sheet-${set.name.toLowerCase()}`;
  const header = document.createElement("header");
  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = set.title;
  const description = document.createElement("p");
  description.textContent = `${set.frames} evenly sampled poses · ${clip.duration.toFixed(3)} s source cycle · near/far limb guides`;
  copy.append(title, description);
  const actions = document.createElement("div");
  actions.className = "sheet-actions";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export readable sprites";
  const poseExportButton = document.createElement("button");
  poseExportButton.type = "button";
  poseExportButton.textContent = "Export pose guide";
  actions.append(exportButton, poseExportButton);
  header.append(copy, actions);

  const cellWidth = 190;
  const imageHeight = 190;
  const labelHeight = 24;
  const rows = Math.ceil(set.frames / set.columns);
  const sheetCanvas = document.createElement("canvas");
  sheetCanvas.width = cellWidth * set.columns;
  sheetCanvas.height = (imageHeight + labelHeight) * rows;
  const context = sheetCanvas.getContext("2d");
  context.fillStyle = "#fffdf7";
  context.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
  const assetCanvas = document.createElement("canvas");
  assetCanvas.width = cellWidth * set.columns;
  assetCanvas.height = imageHeight * rows;
  const assetContext = assetCanvas.getContext("2d");
  const poseCanvas = document.createElement("canvas");
  poseCanvas.width = cellWidth * set.columns;
  poseCanvas.height = imageHeight * rows;
  const poseContext = poseCanvas.getContext("2d");
  const poseCellCanvas = document.createElement("canvas");
  poseCellCanvas.width = cellWidth;
  poseCellCanvas.height = imageHeight;
  const poseCellContext = poseCellCanvas.getContext("2d");

  const savedClip = activeClip?.name;
  const savedPhase = phase;
  setClip(set.name, 0);
  const overlayVisible = jointPoints.visible;
  jointPoints.visible = false;
  boneLines.visible = false;

  for (let index = 0; index < set.frames; index += 1) {
    phase = index / set.frames;
    updatePose();
    const column = index % set.columns;
    const row = Math.floor(index / set.columns);
    const x = column * cellWidth;
    const y = row * (imageHeight + labelHeight);
    context.drawImage(renderer.domElement, x, y, cellWidth, imageHeight);
    drawLimbGuides(context, x, y, cellWidth, imageHeight, GUIDE_STYLES.presentation);
    context.strokeStyle = "#d8ceba";
    context.strokeRect(x + .5, y + .5, cellWidth - 1, imageHeight + labelHeight - 1);
    context.fillStyle = "#17251f";
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(`${String(index + 1).padStart(2, "0")} · ${canonicalLabel(set.name, index, set.frames)}`, x + cellWidth / 2, y + imageHeight + 16);

    setSilhouetteColor(SILHOUETTE_COLORS.asset);
    ground.visible = false;
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const assetY = row * imageHeight;
    assetContext.drawImage(renderer.domElement, x, assetY, cellWidth, imageHeight);
    drawLimbGuides(assetContext, x, assetY, cellWidth, imageHeight, GUIDE_STYLES.asset);

    poseCellContext.clearRect(0, 0, cellWidth, imageHeight);
    poseCellContext.globalCompositeOperation = "source-over";
    poseCellContext.drawImage(renderer.domElement, 0, 0, cellWidth, imageHeight);
    drawPoseRegions(poseCellContext, 0, 0, cellWidth, imageHeight);
    poseContext.drawImage(poseCellCanvas, x, assetY);

    setSilhouetteColor(SILHOUETTE_COLORS.presentation);
    ground.visible = true;
    renderer.setClearColor(0xfffdf7, 1);
    renderer.render(scene, camera);
  }

  jointPoints.visible = overlayVisible;
  boneLines.visible = overlayVisible;
  if (savedClip) setClip(savedClip, savedPhase);
  sheetCanvas.dataset.clipName = set.name;
  sheetCanvas.dataset.exportPng = assetCanvas.toDataURL("image/png");
  sheetCanvas.dataset.posePng = poseCanvas.toDataURL("image/png");
  exportButton.addEventListener("click", () => downloadCanvas(assetCanvas, `caatuu-${set.name.toLowerCase()}-readable-sprite-sheet.png`));
  poseExportButton.addEventListener("click", () => downloadCanvas(poseCanvas, `caatuu-${set.name.toLowerCase()}-pose-guide-sheet.png`));
  sheetCanvas.addEventListener("click", (event) => {
    const bounds = sheetCanvas.getBoundingClientRect();
    const scaleX = sheetCanvas.width / bounds.width;
    const scaleY = sheetCanvas.height / bounds.height;
    const column = Math.floor((event.clientX - bounds.left) * scaleX / cellWidth);
    const row = Math.floor((event.clientY - bounds.top) * scaleY / (imageHeight + labelHeight));
    const index = row * set.columns + column;
    if (index >= set.frames) return;
    playing = false;
    playButton.textContent = "Play";
    setClip(set.name, index / set.frames);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  card.append(header, sheetCanvas);
  return card;
}

function buildReferenceSheets() {
  referenceSets.replaceChildren();
  for (const set of CLIP_SETS) {
    const sheet = createSheet(set);
    if (sheet) referenceSets.append(sheet);
  }
}

function animate(now) {
  const delta = Math.min(.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (playing && activeClip) {
    phase = (phase + delta / activeClip.duration) % 1;
    updatePose();
  }
  requestAnimationFrame(animate);
}

clipSelect.addEventListener("change", () => {
  playing = false;
  playButton.textContent = "Play";
  setClip(clipSelect.value, 0);
});

playButton.addEventListener("click", () => {
  playing = !playing;
  playButton.textContent = playing ? "Pause" : "Play";
});

phaseControl.addEventListener("input", () => {
  playing = false;
  playButton.textContent = "Play";
  phase = Number(phaseControl.value);
  updatePose();
});

jointToggle.addEventListener("change", () => {
  jointPoints.visible = jointToggle.checked;
  boneLines.visible = jointToggle.checked;
  renderer.render(scene, camera);
});

for (const button of document.querySelectorAll("[data-phase]")) {
  button.addEventListener("click", () => {
    playing = false;
    playButton.textContent = "Play";
    phase = Number(button.dataset.phase);
    updatePose();
  });
}

new ResizeObserver(resizeRenderer).observe(stageWrap);

setStatus("Renderer ready · loading 6.7 MB motion source…");

new THREE.GLTFLoader().load(
  SOURCE_URL,
  (gltf) => {
    model = gltf.scene;
    model.traverse((object) => {
      if (object.isMesh) {
        const silhouetteMaterial = new THREE.MeshBasicMaterial({ color: SILHOUETTE_COLORS.presentation, side: THREE.DoubleSide });
        silhouetteMaterial.skinning = Boolean(object.isSkinnedMesh);
        object.material = silhouetteMaterial;
        silhouetteMaterials.push(silhouetteMaterial);
        object.frustumCulled = false;
      }
      if (object.isBone) boneObjects.set(object.name, object);
    });
    scene.add(model);
    clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
    setClip("Walk_Loop", 0);
    frameModel();
    buildReferenceSheets();
    setClip("Walk_Loop", 0);
    setStatus(`${gltf.animations.length} clips loaded · source rig intact`, "ready");
  },
  (progress) => {
    if (!progress.total) return;
    const percent = Math.min(100, progress.loaded / progress.total * 100);
    setStatus(`Loading motion source · ${percent.toFixed(0)}%`);
  },
  (error) => {
    console.error(error);
    setStatus("Unable to load the motion source", "error");
  },
);

requestAnimationFrame(animate);
