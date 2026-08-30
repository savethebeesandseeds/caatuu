const course = globalThis.CaatuuCourse;

if (!course || typeof course !== "object") {
  throw new Error("The course profile must load before the shared Word World host.");
}

const state = {
  active: false,
  controller: null,
  display: Object.freeze({ theme: "dark", fontSize: "largest" }),
  loading: null
};

function courseUrl(path) {
  const routeBase = `${String(course.routePrefix || "").replace(/\/$/u, "")}/`;
  return new URL(
    String(path || "").replace(/^\.\//u, ""),
    `${globalThis.location.origin}${routeBase}`
  ).href;
}

async function loadJson(url) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}

function elements() {
  return Object.freeze({
    root: document.getElementById("wordWorldRoot"),
    stage: document.getElementById("wordNetEmbeddedStage"),
    status: document.getElementById("wordNetEmbeddedStatus")
  });
}

function setStatus(kind, title, detail) {
  const { status } = elements();
  if (!status) return;
  status.hidden = false;
  status.classList.toggle("is-error", kind === "error");
  const heading = status.querySelector("strong");
  const copy = status.querySelector("small");
  if (heading) heading.textContent = title;
  if (copy) copy.textContent = detail;
}

function syncControllerActivity() {
  const controller = state.controller;
  if (!controller) return;
  controller.setDisplay?.(state.display);
  if (state.active) controller.resume?.();
  else controller.pause?.();
}

async function loadController() {
  const { root, stage, status } = elements();
  if (!root || !stage) throw new Error("The authoritative Word World component tree is missing.");

  stage.dataset.loading = "true";
  stage.setAttribute("aria-busy", "true");
  setStatus(
    "loading",
    "",
    ""
  );

  try {
    const manifest = await loadJson(courseUrl("data/games/word-world/manifest.json"));
    stage.dataset.provider = String(manifest.sessionProvider?.kind || manifest.mode || "course-content");
    const { mountWordWorld } = await import("./word-world-provider.mjs?v=word-world-provider-9");
    const controller = await mountWordWorld(root, course, manifest);
    if (!controller || typeof controller !== "object") {
      throw new Error("The shared Word World renderer did not return its controller.");
    }
    state.controller = controller;
    root.classList.add("is-ready");
    stage.dataset.ready = "true";
    stage.dataset.loading = "false";
    stage.setAttribute("aria-busy", "false");
    if (status) {
      status.hidden = true;
      status.classList.remove("is-error");
    }
    syncControllerActivity();
    document.dispatchEvent(new CustomEvent("caatuu:word-world-ready", {
      detail: Object.freeze({ courseId: course.id })
    }));
    return controller;
  } catch (error) {
    stage.dataset.loading = "false";
    stage.dataset.ready = "false";
    stage.setAttribute("aria-busy", "false");
    setStatus(
      "error",
      "Word World could not start",
      String(error?.message || "Return to the planets and try opening it again.")
    );
    throw error;
  }
}

function ensureLoaded() {
  if (state.controller) return Promise.resolve(state.controller);
  if (!state.loading) {
    state.loading = loadController().catch((error) => {
      state.loading = null;
      throw error;
    });
  }
  return state.loading;
}

function setActive(active, display = {}) {
  state.active = Boolean(active);
  state.display = Object.freeze({
    theme: String(display.theme || document.documentElement.dataset.theme || "dark"),
    fontSize: String(display.fontSize || document.documentElement.dataset.fontSize || "largest")
  });
  syncControllerActivity();
}

function ready() {
  return Boolean(state.controller);
}

function next() {
  state.controller?.next?.();
}

export const CaatuuWordWorldHost = Object.freeze({
  ensureLoaded,
  setActive,
  ready,
  next
});

globalThis.CaatuuWordWorldHost = CaatuuWordWorldHost;

export default CaatuuWordWorldHost;
