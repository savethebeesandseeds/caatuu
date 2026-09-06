import assert from "node:assert/strict";

// One policy for the pre-Gradle asset compiler and the final signed archives.
export const FORBIDDEN_FIRST_PARTY_SOURCE_PATTERNS = Object.freeze([
  /@mlc-ai\/web-llm/i,
  /(?:^|["'`(\s])(?:\.\/|\.\.\/|\/)?data\/models\//i,
  /\b(?:llama\.cpp|ggml|gguf|webllm)\b/i,
  /\bdebug-chat\b/i,
  /\bchat\.html\b/i,
  /\bwordNetGenerativeDialog\b/,
  /data-content-mode\s*=\s*["']generative["']/i,
  /\bGenerative mode\b/i,
  /\bmodels\.generate\s*\(/,
  /\b(?:loadModelCatalog|loadBrowserModel|generateBrowser|browserFallbackModel|webllmCdn)\b/,
  /nativeCall\(\s*["'](?:prompt|start_download|cancel_download|reset_conversation|benchmark|delete_model)["']/,
  /["'](?:prompt|start_download|cancel_download|reset_conversation|benchmark|delete_model)["']\s*->/,
  /(?:^|["'`(\s])\/?games\/caatuu-game(?:\/|\b)/i,
  /\bgodot-v\d+\b/i,
]);

export function assertProductSourceText(source, label) {
  for (const pattern of FORBIDDEN_FIRST_PARTY_SOURCE_PATTERNS) {
    assert.doesNotMatch(source, pattern, `${label} contains forbidden product pattern ${pattern}`);
  }
}
