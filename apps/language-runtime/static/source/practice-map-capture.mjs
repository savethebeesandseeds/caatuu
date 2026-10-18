// Manually invoked local diagnostic, deliberately absent from app-assets.json.
import { sharedPracticeAxes, projectPracticeCompass } from "./practice-compass.mjs";
import { embedSharedEnglishTexts, normalizeSharedEnglishText, peekSharedEnglishVector } from "./english-image-search.mjs?v=english-image-search-5";
if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) throw new Error("Local diagnostic only.");
const button = document.querySelector("#capture"), status = document.querySelector("#status");
const frames = document.querySelector("#courses"), output = document.querySelector("#output"), summary = document.querySelector("#summary");
const compareButton = document.querySelector("#compare");
const courseFrames = new Map();

function downloadJson(selector, value, name) {
  const link = document.querySelector(selector);
  if (link.getAttribute("href")) URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.download = name;
  link.hidden = false;
}

async function captureAllProfiles() {
  const capture = { schemaVersion: 1, kind: "real-browser-retained-practice", capturedAt: new Date().toISOString(),
    historicalSnapshotsUnavailable: "Earlier ratios were observed without saved history snapshots; this captures current retained records.", profiles: [] };
  try {
    const registry = await (await fetch("/languages.json", { cache: "no-store" })).json();
    for (const entry of registry.browserSetup.courses) {
      status.textContent = `Opening ${entry.id}…`;
      // Keep the first course realm alive: it owns the shared model's code.
      let frame = courseFrames.get(entry.id);
      if (!frame) {
        frame = document.createElement("iframe");
        frame.title = `Course ${entry.id} being inspected`; frame.width = "600"; frame.height = "250";
        frame.src = entry.entryPath; frames.append(frame); courseFrames.set(entry.id, frame);
      }
      await new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = () => {
          const app = frame.contentWindow;
          if (app?.CaatuuCourse?.id === entry.id && app?.CaatuuLearning && app?.CaatuuPracticeCompass) return resolve();
          if (Date.now() - started > 30000) return reject(new Error(`Course ${entry.id} did not become ready.`));
          setTimeout(poll, 100);
        }; poll();
      });
      const app = frame.contentWindow, learning = app.CaatuuLearning;
      const compass = app.CaatuuPracticeCompass;
      const profile = { courseId: entry.id, capturedAt: new Date().toISOString(), summary: learning.practiceSummary(), banks: [], checkpoints: [] };
      for (const game of profile.summary.games) for (const bank of game.banks) profile.banks.push({
        gameId: game.gameId, bankId: bank.bankId, history: learning.contentHistory(game.gameId, bank.bankId)
      });
      // Preserve browser engine outcomes. The Node replay can use these exact histories independently.
      for (let pass = 0; pass < 3; pass++) {
        status.textContent = `Mapping ${entry.id}, bounded pass ${pass + 1}…`;
        try {
          const result = await compass.project({ diagnostics: true });
          profile.checkpoints.push(result);
          if (!result.pendingTexts) {
            profile.warmCheckpoint = await compass.project({ diagnostics: true });
            break;
          }
        } catch (error) { profile.checkpoints.push({ error: error.message }); break; }
      }
      capture.profiles.push(profile);
      output.textContent = JSON.stringify(capture, null, 2);
      summary.textContent = capture.profiles.map(p => `${p.courseId}: ${JSON.stringify(p.checkpoints.at(-1)?.counts || p.checkpoints.at(-1))}`).join("\n");
    }
    status.textContent = "Capture complete. Expand Captured JSON to inspect or export the page content.";
    return capture;
  } catch (error) { status.textContent = `Capture stopped: ${error.message}`; throw error; }
  finally {
    downloadJson("#download", capture, `caatuu-practice-map-${Date.now()}.json`);
  }
}

button.addEventListener("click", async () => {
  button.disabled = true; compareButton.disabled = true;
  try { await captureAllProfiles(); } catch { /* The status and partial export retain the failure. */ }
  finally { button.disabled = false; compareButton.disabled = false; }
});

const compactProbeTexts = Object.freeze(["People and relationships", "Home and learning", "Food and shopping", "Places and travel",
  "Actions and abilities", "Time and future plans", "Nature and descriptions"]);
// Frozen before inference. These English meanings occur in the retained real
// content audit; judgments are diagnostic expectations, not validated labels.
const reviewMeanings = Object.freeze([
  ["thank you", "clear", ["people"]],
  ["yes", "generic-negative", []], ["no", "generic-negative", []], ["maybe", "generic-negative", []],
  ["to eat", "legitimate-overlap", ["food-shopping", "actions-abilities"]],
  ["to travel", "legitimate-overlap", ["places-travel", "actions-abilities"]],
  ["school", "clear", ["home-school"]], ["money", "clear", ["food-shopping"]],
  ["tomorrow", "clear", ["time-plans"]], ["weather", "clear", ["world-description"]],
  ["friend", "clear", ["people"]]
].map(([englishText, kind, expectedTopics]) => Object.freeze({ englishText, kind, expectedTopics: Object.freeze(expectedTopics) })));
const identityKey = identity => JSON.stringify([identity.courseId, identity.gameId, identity.bankId, identity.itemId]);
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(value => value.toString(16).padStart(2, "0")).join("");

async function compareCompactTopics() {
  const comparison = { schemaVersion: 1, kind: "frozen-browser-topic-probe-comparison", startedAt: new Date().toISOString(),
    baseline: sharedPracticeAxes.map(axis => ({ id: axis.id, text: axis.probe.text })),
    candidate: sharedPracticeAxes.map((axis, index) => ({ id: axis.id, text: compactProbeTexts[index] })),
    constants: { cosineFloor: 0.3, kernelExponent: 2, saturationDenominator: 2 },
    reviewSelectionBeforeScores: reviewMeanings, profiles: [], review: [], encodingErrors: [], rejectedInputs: [],
    limits: "Current retained histories and eleven frozen real English examples; not a full inventory or labeled semantic benchmark. Increased matching alone is not better routing. No history, goal or practice policy is changed." };
  const resultOutput = document.querySelector("#comparisonOutput"), resultSummary = document.querySelector("#comparisonSummary");
  const publish = () => { resultOutput.textContent = JSON.stringify(comparison, null, 2); };
  publish();
  try {
    const capture = await captureAllProfiles();
    comparison.capture = capture;
    // The first retained course realm owns this engine. Never create a second
    // model in the diagnostic parent's stricter CSP or discard the owning frame.
    const ranking = window[Symbol.for("caatuu.sharedImageRanking.v2")];
    if (!ranking?.engine) throw new Error("No existing course-owned model; a retained course must initialize the normal map first.");
    const runtime = ranking.engine.runtime;
    const catalogResponse = await fetch("/language-runtime/embedding-runtimes.json", { cache: "no-store" });
    const catalogText = catalogResponse.ok ? await catalogResponse.text() : null;
    const catalog = catalogText ? JSON.parse(catalogText) : null;
    const declared = catalog?.runtimes?.find(entry => entry.runtime.modelId === runtime.modelId);
    comparison.provenance = { backend: "browser-WASM", individualInputs: true, modelRuntime: runtime,
      declaredModel: declared || null, catalogSha256: catalogText ? await sha256(catalogText) : null,
      sourceHashScope: "Network responses fetched during this comparison; these hashes do not attest modules or cached vectors already loaded by the owning iframe. Reload before capture after changing source.",
      loadedSourceVersionsAttested: false,
      userAgent: navigator.userAgent, inferenceRecipe: "shared-English-individual-input-v1", batchSize: 8,
      runtimeSourceSha256: await sha256(await (await fetch("/language-runtime/static/source/english-minilm-ranker.mjs", { cache: "no-store" })).text()),
      projectionSourceSha256: await sha256(await (await fetch("/language-runtime/static/source/practice-compass.mjs", { cache: "no-store" })).text()) };
    const profiles = [];
    for (const profile of capture.profiles) {
      const resolved = await courseFrames.get(profile.courseId).contentWindow.CaatuuPracticeCompass.resolve();
      const meanings = new Map(resolved.items.map(item => [identityKey(item.identity), item]));
      const items = [];
      for (const bank of profile.banks) for (const [itemId, history] of Object.entries(bank.history)) {
        const identity = { courseId: profile.courseId, gameId: bank.gameId, bankId: bank.bankId, itemId };
        const resolvedItem = meanings.get(identityKey(identity));
        if (!resolvedItem) throw new Error(`Course ${profile.courseId} changed during capture; retry from the new snapshot.`);
        items.push({ ...resolvedItem, history });
      }
      profiles.push({ courseId: profile.courseId, items });
    }
    const inputTexts = [...new Set([...comparison.baseline.map(axis => axis.text), ...compactProbeTexts,
      ...profiles.flatMap(profile => profile.items.filter(item => !item.unmappedReason).map(item => item.text)),
      ...reviewMeanings.map(row => row.englishText)])];
    const texts = [], vectors = new Map();
    for (const text of inputTexts) {
      try { texts.push(normalizeSharedEnglishText(text)); }
      catch (error) { comparison.rejectedInputs.push({ text, detail: error.message }); }
    }
    for (const profile of profiles) for (const item of profile.items) if (item.englishIssue) comparison.rejectedInputs.push({ identity: item.identity, ...item.englishIssue });
    comparison.inputs = { unique: texts.length, texts, sha256: await sha256(JSON.stringify(texts)) };
    comparison.selectionFrozenAt = new Date().toISOString();
    publish();
    for (let offset = 0; offset < texts.length; offset += 8) {
      const batch = texts.slice(offset, offset + 8);
      status.textContent = `Comparing frozen topics: ${offset} / ${texts.length} English vectors…`;
      try {
        const values = await embedSharedEnglishTexts(batch, { owner: window, timeoutMs: 10000, individualInputs: true });
        batch.forEach((text, index) => vectors.set(text, values[index]));
      } catch (error) {
        comparison.encodingErrors.push({ phase: "initial", texts: batch, detail: error.message });
        // A completed singleton remains valid after a later item times out.
        for (const text of batch) {
          const cached = peekSharedEnglishVector(text, { owner: window, individualInputs: true });
          if (cached) vectors.set(text, cached);
        }
      }
    }
    const missing = texts.filter(text => !vectors.has(text));
    for (const text of missing) {
      try { vectors.set(text, (await embedSharedEnglishTexts([text], { owner: window, timeoutMs: 10000, individualInputs: true }))[0]); }
      catch (error) { comparison.encodingErrors.push({ phase: "single-retry", texts: [text], detail: error.message }); }
    }
    const axes = probes => Object.fromEntries(sharedPracticeAxes.map((axis, index) => [axis.id, vectors.get(probes[index])]));
    const axisVectors = { baseline: axes(comparison.baseline.map(axis => axis.text)), candidate: axes(compactProbeTexts) };
    const project = (courseId, items, variant) => projectPracticeCompass({ courseId, diagnostics: true, axisVectors: axisVectors[variant],
      items: items.map(item => ({ ...item, vector: vectors.get(item.text), mappingState: vectors.has(item.text) ? "completed" : "failed" })) });
    for (const profile of profiles) comparison.profiles.push({ courseId: profile.courseId, retainedItems: profile.items,
      baseline: project(profile.courseId, profile.items, "baseline"), candidate: project(profile.courseId, profile.items, "candidate") });
    const assess = (projection, expected) => ({
      missedExpectedTopics: expected.filter(id => !projection.records[0].topics.some(topic => topic.id === id && topic.weight > 0)),
      unexpectedPositiveTopics: projection.records[0].topics.filter(topic => topic.weight > 0 && !expected.includes(topic.id)).map(topic => topic.id)
    });
    for (const [index, row] of reviewMeanings.entries()) {
      const items = [{ identity: { courseId: "review", gameId: "diagnostic", bankId: "frozen-real-meanings", itemId: `review-${index}` }, text: row.englishText, history: { exposures: 1 } }];
      const baseline = project("review", items, "baseline"), candidate = project("review", items, "candidate");
      comparison.review.push({ ...row, baseline, candidate, baselineAssessment: assess(baseline, row.expectedTopics), candidateAssessment: assess(candidate, row.expectedTopics) });
    }
    // Repeat the same individual inputs without replacing the frozen vectors.
    // This distinguishes a warm-repeat check from retuning or a second wording.
    let maximumComponentDifference = 0;
    const warmErrors = [];
    for (let offset = 0; offset < texts.length; offset += 8) {
      const batch = texts.slice(offset, offset + 8).filter(text => vectors.has(text));
      if (!batch.length) continue;
      status.textContent = `Checking warm repeat: ${offset} / ${texts.length} English vectors…`;
      try {
        const warm = await embedSharedEnglishTexts(batch, { owner: window, timeoutMs: 10000, individualInputs: true });
        batch.forEach((text, index) => warm[index].forEach((value, component) => {
          maximumComponentDifference = Math.max(maximumComponentDifference, Math.abs(value - vectors.get(text)[component]));
        }));
      } catch (error) { warmErrors.push({ texts: batch, detail: error.message }); }
    }
    comparison.warmRepeat = { maximumComponentDifference, errors: warmErrors, complete: !warmErrors.length && vectors.size === texts.length };
    comparison.unavailableTexts = texts.filter(text => !vectors.has(text));
    comparison.completedAt = new Date().toISOString();
    const topicNames = projection => projection.records[0].topics.filter(topic => topic.weight > 0).map(topic => topic.id).join(", ") || "none";
    resultSummary.textContent = [
      ...comparison.profiles.map(profile => `${profile.courseId}: ${profile.baseline.counts.mappedItems}/${profile.baseline.counts.encounteredItems} baseline → ${profile.candidate.counts.mappedItems}/${profile.candidate.counts.encounteredItems} compact; peak radius ${Math.max(...profile.baseline.axes.map(axis => axis.practice || 0)).toFixed(6)} → ${Math.max(...profile.candidate.axes.map(axis => axis.practice || 0)).toFixed(6)}`),
      ...comparison.review.map(row => `${row.englishText}: ${topicNames(row.baseline)} → ${topicNames(row.candidate)}; missed ${row.candidateAssessment.missedExpectedTopics.join(", ") || "none"}; unexpected ${row.candidateAssessment.unexpectedPositiveTopics.join(", ") || "none"}`),
      `Warm repeat maximum component difference: ${maximumComponentDifference}; encoding errors: ${comparison.encodingErrors.length}; unavailable texts: ${comparison.unavailableTexts.length}`
    ].join("\n");
    status.textContent = "Frozen compact topic comparison complete. Inspect or save Comparison JSON.";
  } catch (error) {
    comparison.error = error.message;
    status.textContent = `Comparison stopped: ${error.message}`;
  } finally {
    publish();
    downloadJson("#comparisonDownload", comparison, `caatuu-topic-probe-comparison-${Date.now()}.json`);
  }
}

compareButton.addEventListener("click", async () => {
  button.disabled = true; compareButton.disabled = true;
  try { await compareCompactTopics(); }
  finally { button.disabled = false; compareButton.disabled = false; }
});
