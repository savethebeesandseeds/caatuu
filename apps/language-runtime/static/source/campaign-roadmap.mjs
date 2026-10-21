const ROBOT_COUNT = 33;
const ART = "/language-runtime/static/assets/campaign/";
const ROW_HEIGHT = 156;
const ROUTE_HEADROOM = 24;
const ENDPOINT_HEIGHT = 156;
const MACAW_SCENES = ["lantern", "jump", "astronaut", "balance", "chest", "lever", "high-five"];

/** A view of the shared ledger, never a second source of progress or rewards. */
export function campaignRoadmapModel(practice) {
  if (!practice) return null;
  const stage = practice.progression?.stage ?? null;
  const position = stage?.cycle ?? practice.cycle;
  const target = Math.max(1, Number(position?.target) || 16);
  const stageComplete = stage?.stageComplete === true;
  const completed = stageComplete ? target : Math.min(target, Math.max(0, Number(position?.sets) || 0));
  const completedCycles = Math.max(0, Number(position?.completed) || 0);
  const cycle = stageComplete && Number.isFinite(stage.targetCycles)
    ? Math.max(0, stage.targetCycles - 1) : completedCycles;
  const effortTarget = Math.max(1, Number(stage?.target ?? practice.target) || 24);
  return {
    cycle: cycle + 1, target, completed,
    effort: Math.min(effortTarget, Math.max(0, Number(stage?.effort ?? practice.effort) || 0)),
    effortTarget, stage, stageComplete,
    available: practice.progression?.available !== false,
    sets: Array.from({ length: target }, (_, index) => ({
      number: index + 1,
      status: index < completed ? "complete" : index === completed ? "current" : "upcoming",
      robot: `${ART}robot-${String((cycle * target + index) % ROBOT_COUNT + 1).padStart(2, "0")}.webp`,
      x: [29, 71, 71, 29][index % 4]
    }))
  };
}

/** Campaign's shared main screen. Starting it delegates to the existing rotation. */
export function installCampaignRoadmap({ scope = globalThis.window ?? globalThis,
  document = scope.document, learning = scope.CaatuuLearning, i18n = scope.CaatuuI18n,
  onContinue = () => scope.CaatuuWorkspaceShell?.startCampaign?.() } = {}) {
  const root = document?.getElementById("trainPanelCampaign");
  if (!root) return Object.freeze({ refresh() {}, show() {}, destroy() {} });
  let active = false, signature = "", destroyed = false;
  const listeners = [];
  const t = (id, parameters = {}) => i18n.t(id, parameters);
  const node = (tag, className, text) => {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  };
  const art = (src, className) => {
    const image = node("img", className);
    image.src = src; image.alt = ""; image.decoding = "async";
    image.setAttribute("aria-hidden", "true");
    return image;
  };
  const badgeName = level => learning?.difficultyOption?.(level)?.label || String(level);
  const listen = (target, event, handler) => {
    target?.addEventListener?.(event, handler);
    listeners.push(() => target?.removeEventListener?.(event, handler));
  };
  function openBadgeDetails() {
    scope.CaatuuChrome?.openSharedSettings?.({ view: "items" });
    const slot = document.querySelector("[data-caatuu-badge-progression]");
    slot?.scrollIntoView?.({ block: "center" });
    slot?.focus?.({ preventScroll: true });
  }
  function stageCard(model) {
    const stage = model.stage;
    const section = node("section", "campaign-stage");
    section.setAttribute("aria-label", t("practice.stage.label"));
    if (!stage || !model.available) {
      section.append(node("p", "", t("campaign.progress.unavailable")));
      section.append(cycleSummary(model));
      return section;
    }
    const current = stage.difficulty;
    const next = current >= 3 || stage.targetCycles === null ? current : current + 1;
    const medal = level => {
      const value = node("div", "campaign-medal");
      value.append(art(`/assets/icons/difficulty_flag_${level}_ui.png?v=flags-2`, ""),
        node("strong", "", badgeName(level)));
      return value;
    };
    const copy = node("div", "campaign-stage-copy");
    const count = stage.targetCycles === null
      ? t("practice.stage.final", { cycles: stage.completedCycles })
      : t("campaign.stage.progress", { cycles: Math.min(stage.completedCycles, stage.targetCycles), target: stage.targetCycles });
    copy.append(node("strong", "campaign-stage-count", count));
    if (stage.targetCycles !== null) {
      const progress = node("progress", "campaign-stage-progress");
      progress.max = stage.targetCycles * model.target;
      progress.value = Math.min(progress.max, stage.completedSets);
      progress.setAttribute("aria-label", count);
      copy.append(progress);
    }
    const caption = node("div", "campaign-stage-caption");
    caption.append(node("small", "", t(current >= 3 || stage.targetCycles === null ? "campaign.stage.final" : "campaign.stage.readiness")));
    const details = node("button", "campaign-badge-details", t("campaign.badge.details"));
    details.type = "button";
    details.addEventListener("click", openBadgeDetails);
    caption.append(details);
    copy.append(caption);
    const badges = node("div", "campaign-stage-badges");
    badges.append(medal(current), copy);
    if (next !== current) badges.append(medal(next));
    section.append(badges, cycleSummary(model));
    return section;
  }
  function cycleSummary(model) {
    const summary = node("div", "campaign-cycle-heading");
    const copy = node("div", "");
    copy.append(node("h1", "", t("campaign.cycle.title", { cycle: model.cycle })),
      node("p", "", t("campaign.cycle.summary", { sets: model.target, effort: model.effortTarget })));
    const start = node("button", "campaign-jump", t("campaign.continue"));
    start.type = "button";
    start.disabled = !model.available || (!model.stageComplete && !model.sets.some(set => set.status === "current"));
    start.addEventListener("click", continueCurrentSet);
    summary.append(copy, start);
    return summary;
  }
  function continueCurrentSet() {
    if (destroyed || !active) return;
    const latest = campaignRoadmapModel(learning?.practiceSet?.());
    if (!latest?.available || (!latest.stageComplete && !latest.sets.some(set => set.status === "current"))) return;
    onContinue();
  }
  function route(model) {
    const map = node("div", "campaign-route");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 600 ${ROUTE_HEADROOM + model.target * ROW_HEIGHT + ENDPOINT_HEIGHT}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("campaign-orbit");
    const points = [...model.sets.map((set, index) => ({ x: set.x * 6, y: ROUTE_HEADROOM + index * ROW_HEIGHT + 82 })),
      { x: 300, y: ROUTE_HEADROOM + model.target * ROW_HEIGHT + 54 }];
    points.slice(1).forEach((point, index) => {
      const previous = points[index], middle = (previous.y + point.y) / 2;
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", `M ${previous.x} ${previous.y} C ${previous.x} ${middle}, ${point.x} ${middle}, ${point.x} ${point.y}`);
      path.setAttribute("class", index < model.completed ? "is-complete" : "");
      svg.append(path);
    });
    map.append(svg);
    const list = node("ol", "campaign-stops");
    list.setAttribute("aria-label", t("campaign.sets.label"));
    let sceneIndex = 0;
    model.sets.forEach((set, index) => {
      const item = node("li", `campaign-stop campaign-stop-${set.status}`);
      const current = set.status === "current";
      const stop = node(current ? "button" : "div", "campaign-stop-content");
      const label = t(`campaign.set.${set.status}`, { set: set.number });
      stop.setAttribute("aria-label", label);
      if (current) {
        stop.type = "button";
        stop.setAttribute("aria-current", "step");
        stop.disabled = !model.available;
        stop.addEventListener("click", continueCurrentSet);
      }
      const platform = node("span", "campaign-stop-platform");
      const image = art(set.robot, "campaign-robot");
      image.loading = current || set.number <= 3 ? "eager" : "lazy";
      const number = node("span", "campaign-stop-number", String(set.number));
      if (set.status === "complete") number.append(node("span", "campaign-stop-check", " ✓"));
      platform.append(image, number);
      stop.append(platform);
      if (current) {
        stop.append(node("strong", "campaign-continue", t("campaign.continue")));
        const progress = node("progress", "campaign-set-progress");
        progress.max = model.effortTarget; progress.value = model.effort;
        progress.setAttribute("aria-label", t("practice.set.label"));
        progress.setAttribute("aria-valuetext", t("practice.set.progress", { effort: model.effort, target: model.effortTarget }));
        stop.append(progress);
      }
      item.append(stop);
      // The two-stop vertical stretches leave a clear pocket on the other side.
      if (model.sets[index + 1]?.x === set.x) {
        const scene = MACAW_SCENES[(model.cycle - 1 + sceneIndex++) % MACAW_SCENES.length];
        const side = set.x < 50 ? "right" : "left";
        const image = art(`${ART}macaw-${scene}.webp`, `campaign-side-scene campaign-side-scene-${side}`);
        image.loading = "lazy";
        item.append(image);
      }
      list.append(item);
    });
    map.append(list);
    const finish = node("div", "campaign-cycle-reward");
    finish.append(art(`${ART}cycle-trophy.webp`, ""), node("strong", "", t("campaign.cycle.reward")),
      node("small", "", model.stageComplete ? t("campaign.stage.final") : t("campaign.cycle.next", { cycle: model.cycle + 1 })));
    map.append(finish);
    return map;
  }
  function refresh() {
    if (destroyed || !active) return;
    const model = campaignRoadmapModel(learning?.practiceSet?.());
    const nextSignature = JSON.stringify(model);
    if (nextSignature === signature) return;
    signature = nextSignature;
    root.replaceChildren();
    if (!model) { root.append(node("p", "", t("campaign.progress.unavailable"))); return; }
    root.append(stageCard(model), route(model));
  }
  listen(scope, "caatuu:learning-change", refresh);
  listen(scope, "storage", refresh);
  listen(scope, "pageshow", refresh);
  return Object.freeze({ refresh,
    show(value = true) { active = Boolean(value); if (active) refresh(); },
    destroy() { destroyed = true; listeners.splice(0).forEach(remove => remove()); }
  });
}
