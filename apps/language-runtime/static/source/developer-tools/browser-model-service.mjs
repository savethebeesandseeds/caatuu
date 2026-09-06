// Local browser development adapter. Standard product packaging replaces this
// exact module with an unavailable service and ships no model loader bytes.
export const BROWSER_CHAT_SUPPORTED = true;
export const BROWSER_CHAT_MODEL = "Qwen3-0.6B-q4f16_1-MLC";
const WEBLLM_MODULE = "https://esm.run/@mlc-ai/web-llm";

export function createBrowserModelService({ importModule = (url) => import(url) } = {}) {
  let engine = null;
  let loading = null;
  const status = () => ({ runtime: "browser-webgpu", modelKey: BROWSER_CHAT_MODEL, loaded: Boolean(engine), supported: true });
  const models = {
    async status() { return status(); },
    async load(_key, handlers = {}) {
      if (engine) return status();
      if (!loading) loading = (async () => {
        const webllm = await importModule(WEBLLM_MODULE);
        engine = await webllm.CreateMLCEngine(BROWSER_CHAT_MODEL, {
          initProgressCallback(progress) {
            handlers.onEvent?.({ kind: "progress", message: progress.text, progress: progress.progress });
          }
        });
        return status();
      })().finally(() => { loading = null; });
      return loading;
    },
    async generate(request, handlers = {}) {
      if (!engine) throw new Error("Load the browser model first.");
      const completion = await engine.chat.completions.create({ ...request, model: BROWSER_CHAT_MODEL, stream: true });
      let output = "";
      if (completion?.[Symbol.asyncIterator]) {
        for await (const chunk of completion) {
          const token = String(chunk?.choices?.[0]?.delta?.content || "");
          output += token;
          if (token) handlers.onEvent?.({ kind: "token", token });
        }
      } else output = String(completion?.choices?.[0]?.message?.content || "");
      return { ...status(), output };
    }
  };
  return { available: true, status: status(), models };
}
