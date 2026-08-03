export class LayeredCharacterRig {
  static async load(host, manifestUrl) {
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load character rig: ${response.status}`);
    return new LayeredCharacterRig(host, await response.json(), manifestUrl);
  }

  constructor(host, definition, manifestUrl) {
    this.host = host;
    this.definition = definition;
    this.manifestUrl = manifestUrl;
    this.bones = new Map();
    this.baseUrl = new URL(manifestUrl, window.location.href);
    this.build();
  }

  build() {
    const { width, height } = this.definition.canvas;
    this.host.replaceChildren();
    this.host.style.setProperty("--rig-native-width", `${width}px`);
    this.host.style.setProperty("--rig-native-height", `${height}px`);

    const canvas = document.createElement("div");
    canvas.className = "skeletal-rig-canvas";
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    this.canvas = canvas;

    for (const bone of this.definition.bones) {
      const element = document.createElement("div");
      element.className = "skeletal-rig-bone";
      element.dataset.bone = bone.id;
      element.style.left = `${bone.pivot.x}px`;
      element.style.top = `${bone.pivot.y}px`;
      element.style.zIndex = String(bone.z ?? 0);
      this.bones.set(bone.id, { definition: bone, element });
    }

    for (const bone of this.definition.bones) {
      const entry = this.bones.get(bone.id);
      const parent = bone.parent ? this.bones.get(bone.parent)?.element : canvas;
      if (!parent) throw new Error(`Unknown parent bone: ${bone.parent}`);
      parent.append(entry.element);
    }

    for (const layer of this.definition.layers) {
      const bone = this.bones.get(layer.bone)?.element;
      if (!bone) throw new Error(`Unknown layer bone: ${layer.bone}`);
      const image = document.createElement("img");
      const scaleX = layer.rest?.scaleX ?? 1;
      const scaleY = layer.rest?.scaleY ?? 1;
      image.className = "skeletal-rig-layer";
      image.dataset.layer = layer.id;
      image.src = new URL(layer.src, this.baseUrl).href;
      image.alt = "";
      image.draggable = false;
      image.style.left = `${(layer.rest?.x ?? 0) - layer.pivot.x * scaleX}px`;
      image.style.top = `${(layer.rest?.y ?? 0) - layer.pivot.y * scaleY}px`;
      image.style.width = `${layer.size.width * scaleX}px`;
      image.style.height = `${layer.size.height * scaleY}px`;
      image.style.zIndex = String(layer.z ?? 0);
      bone.append(image);
    }

    this.host.append(canvas);
    this.setPose({});
  }

  setPose(pose) {
    for (const [id, { element }] of this.bones) {
      const transform = pose[id] || {};
      const x = transform.x ?? 0;
      const y = transform.y ?? 0;
      const rotation = transform.rotation ?? 0;
      const scaleX = transform.scaleX ?? 1;
      const scaleY = transform.scaleY ?? 1;
      element.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
    }
  }

  poseAtClip(clipName, phase) {
    const clip = this.definition.clips?.[clipName];
    if (!clip) throw new Error(`Unknown rig clip: ${clipName}`);
    const normalizedPhase = clip.loop
      ? ((phase % 1) + 1) % 1
      : Math.max(0, Math.min(1, phase));
    const pose = {};

    for (const [path, keyframes] of Object.entries(clip.channels || {})) {
      const separator = path.lastIndexOf(".");
      if (separator < 1) throw new Error(`Invalid rig channel: ${path}`);
      const boneId = path.slice(0, separator);
      const property = path.slice(separator + 1);
      if (!this.bones.has(boneId)) throw new Error(`Unknown rig channel bone: ${boneId}`);
      pose[boneId] ||= {};
      pose[boneId][property] = this.sampleChannel(keyframes, normalizedPhase);
    }

    return pose;
  }

  sampleChannel(keyframes, phase) {
    if (!keyframes.length) return 0;
    if (phase <= keyframes[0].at) return keyframes[0].value;
    const last = keyframes[keyframes.length - 1];
    if (phase >= last.at) return last.value;

    for (let index = 1; index < keyframes.length; index += 1) {
      const right = keyframes[index];
      if (phase > right.at) continue;
      const left = keyframes[index - 1];
      const duration = right.at - left.at;
      const progress = duration > 0 ? (phase - left.at) / duration : 1;
      const eased = this.ease(progress, right.ease || left.ease || "linear");
      return left.value + (right.value - left.value) * eased;
    }

    return last.value;
  }

  ease(progress, easing) {
    if (easing === "smooth") return progress * progress * (3 - 2 * progress);
    if (easing === "ease-in") return progress * progress;
    if (easing === "ease-out") return 1 - ((1 - progress) ** 2);
    return progress;
  }

  assetsReady() {
    return Promise.all([...this.host.querySelectorAll("img")].map((image) => {
      if (image.complete) {
        if (!image.naturalWidth) return Promise.reject(new Error(`Unable to load rig layer: ${image.src}`));
        return image.decode?.() || Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", reject, { once: true });
      });
    }));
  }
}
