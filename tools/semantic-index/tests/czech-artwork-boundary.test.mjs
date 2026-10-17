import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../../", import.meta.url);

test("the Czech compatibility database retains curriculum and target texts without shared artwork", async () => {
  const corpus = (await readFile(new URL("tools/czech-ml/data/curriculum/core-v0.2/curated/curriculum-core.en.jsonl", root), "utf8"))
    .trim().split(/\r?\n/u).map(JSON.parse);
  const modelRoot = "apps/languages/czech/static/data/embeddings/all-minilm-l6-v2-qint8-v0.1/";
  const manifest = JSON.parse(await readFile(new URL(`${modelRoot}manifest.json`, root), "utf8"));
  const require = createRequire(import.meta.url);
  const sqlRoot = new URL("apps/languages/czech/static/vendor/sql.js/", root);
  const SQL = await require(fileURLToPath(new URL("sql-wasm.js", sqlRoot)))({
    locateFile: () => fileURLToPath(new URL("sql-wasm.wasm", sqlRoot)),
  });
  const database = new SQL.Database(await readFile(new URL(`${modelRoot}caatuu-cz-curriculum.sqlite`, root)));
  try {
    const scalar = query => database.exec(query)[0].values[0][0];
    assert.equal(scalar("PRAGMA integrity_check"), "ok");
    assert.equal(database.exec("PRAGMA foreign_key_check").length, 0);
    assert.equal(scalar("SELECT value FROM schema_meta WHERE key = 'schema_name'"), "caatuu-cz-vector-db");
    assert.equal(scalar("SELECT count(*) FROM documents"), corpus.length);
    assert.equal(scalar("SELECT count(*) FROM embeddings"), corpus.length);
    assert.equal(scalar("SELECT count(*) FROM documents WHERE source_kind != 'curriculum' OR locale != 'en'"), 0);
    assert.equal(scalar("SELECT count(*) FROM schema_meta WHERE key LIKE '%asset_embedding%' OR key LIKE 'robot_embedding%' OR key LIKE 'macaw_action_embedding%'"), 0);
    for (const table of ["asset_embedding_refs", "robot_embedding_refs", "macaw_action_embedding_refs"]) {
      assert.equal(scalar(`SELECT count(*) FROM ${table}`), 0, table);
    }
    const actual = database.exec(`SELECT d.body, t.target_text FROM target_realizations t
      JOIN documents d ON d.id = t.semantic_document_id WHERE t.course_id = 'czech' AND t.locale = 'cs'`)[0].values;
    assert.equal(actual.length, corpus.length);
    assert.deepEqual(actual.map(JSON.stringify).sort(), corpus.map(row => JSON.stringify([row.english_text, row.czech_text])).sort());
    assert.equal(manifest.embedding_count, corpus.length);
    assert.equal(manifest.asset_count, 0);
  } finally { database.close(); }
});
