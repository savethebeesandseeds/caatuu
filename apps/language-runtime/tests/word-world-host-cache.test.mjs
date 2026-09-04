import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const hostSource = await readFile(
  new URL("../static/source/word-world-host.mjs", import.meta.url),
  "utf8"
);

test("the shared Word World host reloads the course manifest without dropping request metadata", async () => {
  const functionStart = hostSource.indexOf("async function loadJson(url)");
  const functionEnd = hostSource.indexOf("\nfunction elements()", functionStart);
  assert.notEqual(functionStart, -1);
  assert.notEqual(functionEnd, -1);

  const calls = [];
  const context = vm.createContext({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { corpusVersion: "test-v1" };
        }
      };
    }
  });
  const loadJsonSource = hostSource.slice(functionStart, functionEnd);
  context.__manifestUrl = "https://caatuu.test/cz/data/games/word-world/manifest.json";
  const manifest = await vm.runInContext(
    `${loadJsonSource}\nloadJson(__manifestUrl)`,
    context,
    { filename: "word-world-host-load-json.mjs" }
  );

  assert.equal(manifest.corpusVersion, "test-v1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, context.__manifestUrl);
  assert.equal(calls[0].options.cache, "reload");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.match(
    hostSource,
    /loadJson\(courseUrl\("data\/games\/word-world\/manifest\.json"\)\)/u
  );
});
