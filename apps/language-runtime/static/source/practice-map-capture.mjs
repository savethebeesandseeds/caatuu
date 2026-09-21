// Manually invoked local diagnostic, deliberately absent from app-assets.json.
if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) throw new Error("Local diagnostic only.");
const button = document.querySelector("#capture"), status = document.querySelector("#status");
const frames = document.querySelector("#courses"), output = document.querySelector("#output"), summary = document.querySelector("#summary");
const courseFrames = new Map();
button.addEventListener("click", async () => {
  button.disabled = true;
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
  } catch (error) { status.textContent = `Capture stopped: ${error.message}`; }
  finally {
    button.disabled = false;
    const download = document.querySelector("#download");
    if (download.getAttribute("href")) URL.revokeObjectURL(download.href);
    download.href = URL.createObjectURL(new Blob([JSON.stringify(capture, null, 2)], { type: "application/json" }));
    download.download = `caatuu-practice-map-${Date.now()}.json`;
    download.hidden = false;
  }
});
