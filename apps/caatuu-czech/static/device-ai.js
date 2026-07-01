const $ = (selector) => document.querySelector(selector);

let engine = null;
let loadedModelId = "";
let loadedRuntimeKind = "";

const webllmCdn = "https://esm.run/@mlc-ai/web-llm";
const liveModelNote = "Loads into the browser with WebGPU.";
const phoneBench = {
  baseUrl: "https://caatuu.waajacu.com/cz/data/models/phone-bench",
  manifestPath: "data/models/phone-bench/manifest.json",
  scriptName: "termux-run-caatuu-bench.sh",
  modelName: "caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf"
};
const phoneCommand = [
  "pkg update",
  "pkg install -y curl",
  `curl -L ${phoneBench.baseUrl}/${phoneBench.scriptName} -o ${phoneBench.scriptName}`,
  `bash ${phoneBench.scriptName}`
].join("\n");
const czechLoraModel = {
  id: "caatuu-czech-qwen3-1.7b-lora-003-hard",
  name: "Caatuu Czech LoRA qwen3-1.7b-lora-003-hard",
  baseModel: "Qwen/Qwen3-1.7B",
  manifestPath: "data/models/models.json",
  exportManifestPath: "data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/export-manifest.json",
  trainingRunPath: "data/models/czech-finetuned/runs/qwen3-1.7b-lora-003-hard/training-run.json",
  adapterConfigPath: "data/models/czech-finetuned/runs/qwen3-1.7b-lora-003-hard/adapter/adapter_config.json",
  adapterPath: "data/models/czech-finetuned/runs/qwen3-1.7b-lora-003-hard/adapter",
  languageBenchmarkPath: "data/models/benchmarks/czech-language-benchmark-qwen3-1.7b-lora-003-hard.json"
};

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function renderDeviceStatus() {
  const hasWebGpu = "gpu" in navigator;
  setText("#gpuStatus", hasWebGpu ? "Available" : "Missing");
  setText("#cacheStatus", "serviceWorker" in navigator ? "Ready" : "Missing");
  if (!hasWebGpu) {
    setText("#runtimeStatus", "Native fallback ready");
    setText("#progressBox", "This browser cannot run WebLLM here. Use the Native Phone Runner to test the model offline on Android.");
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
    setText("#cacheStatus", "Registered");
  } catch (error) {
    setText("#cacheStatus", "Registration failed");
  }
}

function isCzechLoraSelected() {
  return $("#modelSelect").value === czechLoraModel.id;
}

function updateSelectedModelUi() {
  const modelId = $("#modelSelect").value;
  const isLora = modelId === czechLoraModel.id;

  $("#loadModel").textContent = isLora ? "Load export" : "Load model";
  $("#runPrompt").textContent = isLora ? "Check prompt" : "Run prompt";
  setText(
    "#modelNote",
    isLora
      ? "Loads the generated Caatuu Czech WebLLM export when the manifest is ready."
      : liveModelNote
  );

  if (loadedModelId && loadedModelId !== modelId) {
    engine = null;
    loadedModelId = "";
    loadedRuntimeKind = "";
    $("#runPrompt").disabled = true;
    setText("#runtimeStatus", "Not loaded");
    setText("#progressBox", "Idle");
    setText("#requestPreview", "No request sent yet.");
    setText("#modelOutput", "Model output appears here.");
  }

  if (!isLora) {
    renderArtifactDetails(null);
  }
}

async function loadModel() {
  const modelId = $("#modelSelect").value;
  if (modelId === czechLoraModel.id) {
    await loadCzechLoraArtifact();
    return;
  }

  if (!("gpu" in navigator)) {
    setText("#runtimeStatus", "WebGPU missing");
    setText("#progressBox", "This browser cannot run the live model path.");
    return;
  }

  $("#loadModel").disabled = true;
  $("#runPrompt").disabled = true;
  renderArtifactDetails(null);
  setText("#runtimeStatus", "Loading");
  setText("#progressBox", `Loading ${modelId}`);

  try {
    const webllm = await import(webllmCdn);
    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (progress) => {
        const pct = Number.isFinite(progress.progress) ? ` ${(progress.progress * 100).toFixed(1)}%` : "";
        setText("#progressBox", `${progress.text || "Loading"}${pct}`);
      }
    });
    loadedModelId = modelId;
    loadedRuntimeKind = "webllm-prebuilt";
    setText("#runtimeStatus", "Loaded");
    setText("#progressBox", `${modelId} is ready.`);
    $("#runPrompt").disabled = false;
  } catch (error) {
    engine = null;
    loadedModelId = "";
    loadedRuntimeKind = "";
    setText("#runtimeStatus", "Load failed");
    setText("#progressBox", browserGpuErrorMessage(error));
  } finally {
    $("#loadModel").disabled = false;
  }
}

async function loadCzechLoraArtifact() {
  $("#loadModel").disabled = true;
  $("#runPrompt").disabled = true;
  engine = null;
  loadedModelId = "";
  loadedRuntimeKind = "";
  setText("#runtimeStatus", "Loading artifact");
  setText("#progressBox", "Reading local WebLLM metadata.");

  try {
    const [manifest, training, adapterConfig, exportManifest] = await Promise.all([
      fetchJson(czechLoraModel.manifestPath),
      fetchJson(czechLoraModel.trainingRunPath),
      fetchJson(czechLoraModel.adapterConfigPath),
      fetchOptionalJson(czechLoraModel.exportManifestPath)
    ]);

    if (exportManifest?.webllm?.status === "ready") {
      await loadCzechLoraWebllm(exportManifest);
      return;
    }

    loadedModelId = czechLoraModel.id;
    loadedRuntimeKind = "artifact";
    renderArtifactDetails({ manifest, training, adapterConfig, exportManifest });
    setText("#runtimeStatus", "LoRA artifact");
    setText(
      "#progressBox",
      exportManifest?.webllm?.status
        ? `Caatuu Czech LoRA export status: ${exportManifest.webllm.status}.`
        : "The runtime metadata is local. The full LoRA adapter lives in the ML workspace."
    );
    setText(
      "#modelOutput",
      [
        `${czechLoraModel.name} runtime metadata is present in static/data/models.`,
        "",
        "The full PEFT adapter for Qwen/Qwen3-1.7B lives in tools/caatuu-cz-ml.",
        "Use Show contrast to inspect saved base vs fine-tuned outputs."
      ].join("\n")
    );
    setText("#requestPreview", "No request sent yet.");
    $("#runPrompt").disabled = false;
    await loadBenchmarks();
  } catch (error) {
    renderArtifactDetails(null);
    setText("#runtimeStatus", "Artifact failed");
    setText("#progressBox", error?.message || String(error));
    setText("#modelOutput", "Could not load the local Czech LoRA metadata.");
  } finally {
    $("#loadModel").disabled = false;
  }
}

async function runPrompt() {
  if (isCzechLoraSelected() && loadedRuntimeKind !== "webllm-custom") {
    checkCzechLoraPrompt();
    return;
  }

  if (!engine) {
    setText("#progressBox", "Load a WebGPU model first.");
    return;
  }

  $("#runPrompt").disabled = true;
  setText("#modelOutput", "Running...");
  setText("#progressBox", `Generating with ${loadedModelId}`);

  try {
    const prompt = $("#promptInput").value.trim();
    if (!prompt) {
      setText("#modelOutput", "Type a prompt first.");
      setText("#progressBox", "Waiting for prompt");
      return;
    }

    const messages = [{ role: "user", content: prompt }];
    const request = {
      messages,
      temperature: 0,
      max_tokens: 120
    };
    if (isQwen3Model(loadedModelId)) {
      request.extra_body = { enable_thinking: false };
    }
    setText("#requestPreview", JSON.stringify(request, null, 2));

    const response = await engine.chat.completions.create(request);
    setText("#modelOutput", cleanModelOutput(response.choices?.[0]?.message?.content) || "(empty output)");
    setText("#progressBox", "Done");
  } catch (error) {
    setText("#modelOutput", error?.message || String(error));
    setText("#progressBox", "Generation failed");
  } finally {
    $("#runPrompt").disabled = false;
  }
}

function isQwen3Model(modelId) {
  return String(modelId || "").toLowerCase().includes("qwen3");
}

function cleanModelOutput(content) {
  return String(content || "").replace(/^<think>\s*<\/think>\s*/i, "").trim();
}

async function loadCzechLoraWebllm(exportManifest) {
  if (!("gpu" in navigator)) {
    loadedModelId = czechLoraModel.id;
    loadedRuntimeKind = "artifact";
    setText("#runtimeStatus", "WebGPU missing");
    setText("#progressBox", webGpuUnavailableMessage());
    setText(
      "#modelOutput",
      [
        "The browser model cannot run on this device because WebGPU is unavailable.",
        "",
        "Use the Native Phone Runner above to run the quantized model offline on Android.",
        "",
        phoneCommand
      ].join("\n")
    );
    return;
  }

  setText("#runtimeStatus", "Loading WebLLM");
  setText("#progressBox", `Loading ${exportManifest.webllm.model_id}`);

  try {
    const webllm = await import(webllmCdn);
    const modelRecord = buildCzechLoraModelRecord(webllm, exportManifest);
    engine = await webllm.CreateMLCEngine(modelRecord.model_id, {
      appConfig: { model_list: [modelRecord] },
      initProgressCallback: (progress) => {
        const pct = Number.isFinite(progress.progress) ? ` ${(progress.progress * 100).toFixed(1)}%` : "";
        setText("#progressBox", `${progress.text || "Loading"}${pct}`);
      }
    });
    loadedModelId = modelRecord.model_id;
    loadedRuntimeKind = "webllm-custom";
    setText("#runtimeStatus", "Loaded");
    setText("#progressBox", `${modelRecord.model_id} is ready.`);
    setText("#modelOutput", "The exported Caatuu Czech WebLLM model is ready.");
    setText("#requestPreview", "No request sent yet.");
    $("#runPrompt").textContent = "Run prompt";
    $("#runPrompt").disabled = false;
  } catch (error) {
    console.error("Czech WebLLM load failed", error);
    engine = null;
    loadedModelId = czechLoraModel.id;
    loadedRuntimeKind = "artifact";
    const detail = [error?.message || String(error), error?.stack].filter(Boolean).join("\n\n");
    setText("#runtimeStatus", "Load failed");
    setText("#progressBox", browserGpuErrorMessage(error));
    setText(
      "#modelOutput",
      `The export manifest is ready, but WebLLM could not load the custom model.\n\n${detail}`
    );
    $("#runPrompt").textContent = "Check prompt";
    $("#runPrompt").disabled = false;
  }
}

function buildCzechLoraModelRecord(webllm, exportManifest) {
  const webllmExport = exportManifest.webllm;
  let modelLib = webllmExport.model_lib_url ? toPageUrl(webllmExport.model_lib_url) : "";
  if (!modelLib && webllmExport.reuse_prebuilt_model_lib_from) {
    const prebuilt = webllm.prebuiltAppConfig?.model_list?.find(
      (item) => item.model_id === webllmExport.reuse_prebuilt_model_lib_from
    );
    modelLib = prebuilt?.model_lib || "";
  }
  if (!modelLib) {
    throw new Error("No compatible WebLLM model_lib was found for the Caatuu Czech export.");
  }
  return {
    model: toPageUrl(webllmExport.model_url),
    model_id: webllmExport.model_id,
    model_lib: modelLib,
    required_features: webllmExport.required_features || []
  };
}

function toPageUrl(path) {
  return new URL(path, location.href).href;
}

function checkCzechLoraPrompt() {
  const prompt = $("#promptInput").value.trim();
  if (!prompt) {
    setText("#modelOutput", "Type a prompt first.");
    setText("#progressBox", "Waiting for prompt");
    return;
  }

  const messages = [{ role: "user", content: prompt }];
  setText(
    "#requestPreview",
    JSON.stringify(
      {
        messages,
        sentToRuntime: false,
        reason: "The selected Caatuu Czech export metadata is present locally, but it is not loaded as a WebLLM runtime in this browser session."
      },
      null,
      2
    )
  );
  setText(
    "#modelOutput",
    "Prompt captured only. The Czech export metadata is local, but no live WebLLM runtime is loaded for it in this browser session."
  );
  setText("#progressBox", "No hidden prompt was added and nothing was sent to a model runtime.");
}

function webGpuUnavailableMessage() {
  if (!window.isSecureContext) {
    return [
      "The Czech WebLLM export exists, but this page is not a secure browser context.",
      "LAN HTTP URLs such as http://192.168.x.x cannot expose WebGPU.",
      "Use HTTPS with a trusted certificate, or test through localhost on the phone."
    ].join(" ");
  }
  return "The Czech WebLLM export exists, but this browser or device does not expose WebGPU. Use the Native Phone Runner on this page for the offline Android test.";
}

function browserGpuErrorMessage(error) {
  const message = error?.message || String(error);
  if (/compatible gpu|webgpu|gpu/i.test(message)) {
    return webGpuUnavailableMessage();
  }
  return message;
}

async function cacheProbe() {
  if (!("caches" in window)) {
    setText("#progressBox", "Cache API missing.");
    return;
  }
  const names = await caches.keys();
  setText("#progressBox", names.length ? `Caches: ${names.join(", ")}` : "No cache entries yet.");
}

async function loadBenchmarks() {
  const result = await fetchJson(czechLoraModel.languageBenchmarkPath);
  renderBenchmarks(result.models.base, result.models.tuned);
}

async function loadPhoneBenchStatus() {
  setText("#phoneCommand", phoneCommand);
  try {
    const manifest = await fetchJson(phoneBench.manifestPath);
    const size = formatBytes(manifest.bytes);
    setText("#phoneModelStatus", `${manifest.quantization || "GGUF"} ready (${size})`);
    setText(
      "#phoneBenchNote",
      `Published model: ${manifest.model_file}. SHA256 ${String(manifest.sha256 || "").slice(0, 12)}...`
    );
  } catch (error) {
    setText("#phoneModelStatus", "Public bundle ready");
    setText("#phoneBenchNote", "Use the command above. The model bundle is served from caatuu.waajacu.com.");
  }
}

async function copyPhoneCommand() {
  try {
    await navigator.clipboard.writeText(phoneCommand);
    setText("#phoneBenchNote", "Copied. Paste it into Termux on the Android phone.");
  } catch (error) {
    setText("#phoneBenchNote", "Copy failed. Select the command text manually.");
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "unknown size";
  const gib = value / 1024 / 1024 / 1024;
  return `${gib.toFixed(2)} GiB`;
}

function renderBenchmarks(base, tuned) {
  const tunedById = Object.fromEntries(tuned.prompts.map((item) => [item.id, item]));
  $("#benchmarkList").replaceChildren(
    ...base.prompts.map((item) => {
      const tunedItem = tunedById[item.id];
      const article = document.createElement("article");
      article.className = "benchmark-item";
      article.innerHTML = `
        <h3>${escapeHtml(item.id)}</h3>
        <div class="benchmark-columns">
          <div>
            <b>Base</b>
            <p>${escapeHtml(item.output)}</p>
          </div>
          <div>
            <b>LoRA</b>
            <p>${escapeHtml(tunedItem?.output || "")}</p>
          </div>
        </div>
      `;
      return article;
    })
  );
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchOptionalJson(path) {
  const response = await fetch(path);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

function renderArtifactDetails(details) {
  const node = $("#artifactDetails");
  if (!details) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }

  const { manifest, training, adapterConfig, exportManifest } = details;
  const latestRun = manifest.targets?.czech_finetuned?.latest_run || {};
  const targetModules = Array.isArray(adapterConfig.target_modules)
    ? adapterConfig.target_modules.join(", ")
    : String(adapterConfig.target_modules || "");
  const exportStatus = exportManifest?.webllm?.status || "not exported";
  node.innerHTML = `
    <h3>${escapeHtml(czechLoraModel.name)}</h3>
    <dl>
      <dt>Base</dt>
      <dd>${escapeHtml(training.base_model || czechLoraModel.baseModel)}</dd>
      <dt>Adapter</dt>
      <dd>${escapeHtml(latestRun.ml_adapter || latestRun.adapter || czechLoraModel.adapterPath)}</dd>
      <dt>LoRA</dt>
      <dd>r=${escapeHtml(adapterConfig.r)}, alpha=${escapeHtml(adapterConfig.lora_alpha)}, targets=${escapeHtml(targetModules)}</dd>
      <dt>Steps</dt>
      <dd>${escapeHtml(training.max_steps)} training steps, context ${escapeHtml(training.max_length)}</dd>
      <dt>Runtime</dt>
      <dd>Included as a local WebLLM export; full PEFT files live in the ML workspace.</dd>
      <dt>Export</dt>
      <dd>${escapeHtml(exportStatus)}</dd>
    </dl>
    <p>The prompt runner switches to live WebLLM automatically after the export manifest reports a ready browser package.</p>
  `;
  node.hidden = false;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

renderDeviceStatus();
registerServiceWorker();
updateSelectedModelUi();
loadPhoneBenchStatus();
$("#modelSelect").addEventListener("change", updateSelectedModelUi);
$("#loadModel").addEventListener("click", loadModel);
$("#runPrompt").addEventListener("click", runPrompt);
$("#cacheProbe").addEventListener("click", cacheProbe);
$("#loadBenchmarks").addEventListener("click", loadBenchmarks);
$("#copyPhoneCommand").addEventListener("click", copyPhoneCommand);
