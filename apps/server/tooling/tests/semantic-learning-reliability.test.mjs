import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as core from "../../../languages/czech/static/source/shared/semantic-learning-core.mjs";

const source = await readFile(new URL("../../../languages/czech/static/source/shared/semantic-learning.js", import.meta.url), "utf8");
const prefix = "caatuu-test.semantic-learning.pending-attempt.v1.";

// A dependency-free IndexedDB transaction double. Operations finish asynchronously;
// an aborted transaction restores all its stores, and oncomplete follows requests.
function databaseHarness() {
  const stores = new Map(["attempts", "ledger", "receipts", "evidence", "embeddings", "meta"].map(name => [name, new Map()]));
  const control = { failOpen: false, failAttempt: false, failCommit: false, commits: 0 };
  const database = {
    close() {},
    transaction(names, mode) {
      names = Array.isArray(names) ? names : [names];
      const originals = new Map(names.map(name => [name, structuredClone(stores.get(name))]));
      let revision = 0;
      let ended = false;
      let attempted = false;
      const transaction = {
        abort() {
          if (ended) return;
          ended = true;
          for (const [name, rows] of originals) stores.set(name, rows);
          queueMicrotask(() => transaction.onabort?.());
        },
        objectStore(name) {
          const request = (operation, action) => {
            const output = {};
            const current = ++revision;
            queueMicrotask(() => {
              if (ended) return;
              if (name === "attempts" && operation === "add") {
                attempted = true;
                if (control.failAttempt) {
                  output.error = new Error("Injected IndexedDB quota failure");
                  output.error.name = "QuotaExceededError";
                  transaction.error = output.error;
                  output.onerror?.();
                  transaction.abort();
                  return;
                }
              }
              try {
                output.result = structuredClone(action(stores.get(name)));
                output.onsuccess?.();
              } catch (error) {
                output.error = transaction.error = error;
                output.onerror?.();
                transaction.abort();
              }
              setImmediate(() => {
                if (ended || revision !== current) return;
                if (attempted && control.failCommit) {
                  transaction.error = new Error("Injected transaction commit failure");
                  transaction.abort();
                  return;
                }
                ended = true;
                if (attempted && mode === "readwrite") control.commits += 1;
                transaction.oncomplete?.();
              });
            });
            return output;
          };
          const keyOf = row => row.id ?? row.statementKey ?? row.key;
          const store = {
            get: key => request("get", rows => rows.get(key)),
            getAll: () => request("getAll", rows => [...rows.values()]),
            count: () => request("count", rows => rows.size),
            clear: () => request("clear", rows => rows.clear()),
            delete: key => request("delete", rows => rows.delete(key)),
            put: row => request("put", rows => { rows.set(keyOf(row), structuredClone(row)); return keyOf(row); }),
            add: row => request("add", rows => {
              if (rows.has(keyOf(row))) throw new Error("Duplicate attempt");
              rows.set(keyOf(row), structuredClone(row));
              return keyOf(row);
            }),
            index: field => ({
              getAll: () => request("getAll", rows => [...rows.values()].sort((a, b) => a[field] - b[field])),
              getAllKeys: () => request("getAllKeys", rows => [...rows.values()].sort((a, b) => a[field] - b[field]).map(keyOf))
            })
          };
          return store;
        }
      };
      return transaction;
    }
  };
  return { stores, control, indexedDB: { open() {
    const request = {};
    queueMicrotask(() => {
      if (control.failOpen) {
        request.error = new Error("Injected unavailable IndexedDB");
        request.onerror?.();
      } else {
        request.result = database;
        request.onsuccess?.();
      }
    });
    return request;
  } } };
}

function browser({ db = databaseHarness(), rows = new Map(), storageControl = {}, coreReady = Promise.resolve(core) } = {}) {
  const failures = new Map();
  const listeners = new Map();
  let uuid = 0;
  const window = {
    CaatuuCourse: { id: "test", storage: { namespace: "caatuu-test" } },
    CaatuuLearning: {
      reportSaveFailure(key, error) { failures.set(key, error.message); },
      clearSaveFailure(key) { failures.delete(key); },
      registerSaveRetry(retry) { this.retry = retry; }
    },
    indexedDB: db.indexedDB,
    crypto: { randomUUID: () => `test-${++uuid}` },
    localStorage: {
      get length() { return rows.size; },
      key: index => [...rows.keys()][index] ?? null,
      getItem: key => {
        if (storageControl.failReadKey === key) throw new Error("Injected transient localStorage read failure");
        storageControl.onRead?.(key, rows);
        return rows.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageControl.failWrite) throw new Error("Injected localStorage quota failure");
        rows.set(key, value);
      },
      removeItem(key) {
        if (storageControl.failRemove) throw new Error("Injected localStorage cleanup failure");
        rows.delete(key);
      }
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    }
  };
  vm.runInNewContext(source.replace('import("./semantic-learning-core.mjs?v=semantic-learning-core-5")', "coreReady"), { window, coreReady, Date, console, setTimeout }, { filename: "semantic-learning.js" });
  return { api: window.CaatuuSemanticLearning, window, db, rows, failures, storageControl };
}

const attempt = (id = "answer-1") => ({
  id, occurredAt: "2026-09-07T10:00:00.000Z", activityId: "verb-nebula", itemId: "verb:1",
  signals: [{ conceptId: "test.verb.1", statementRevision: "1", kind: "meaning", locale: "en", text: "Understands the verb.", score: 1, coverageWeight: 1, masteryWeight: 1 }]
});
const pendingRows = rows => [...rows.keys()].filter(key => key.startsWith(prefix));

test("an aborted save rejects, retains its exact durable event, and replays once after reload", async () => {
  const app = browser();
  await app.api.whenIdle();
  app.db.control.failCommit = true;
  await assert.rejects(app.api.recordAttempt(attempt()), /commit failure/);
  assert.equal(app.db.stores.get("attempts").size, 0);
  assert.equal(app.db.stores.get("evidence").size, 0);
  const saved = JSON.parse(app.rows.get(pendingRows(app.rows)[0]));
  assert.equal(saved.attempt.id, "answer-1");
  assert.equal(saved.attempt.occurredAt, attempt().occurredAt);
  assert.ok(app.failures.size);
  app.db.control.failCommit = false;
  const reloaded = browser(app);
  await reloaded.api.whenIdle();
  assert.equal(app.db.stores.get("attempts").size, 1);
  assert.equal(app.db.control.commits, 1);
  assert.equal(pendingRows(app.rows).length, 0);
  await reloaded.api.retryPendingAttempts();
  assert.equal(app.db.control.commits, 1);
});

test("a fallback write failure retains an event in memory and exposes the failure until retry commits", async () => {
  const app = browser();
  await app.api.whenIdle();
  app.storageControl.failWrite = true;
  app.db.control.failAttempt = true;
  await assert.rejects(app.api.recordAttempt(attempt()), /quota failure/);
  assert.equal(pendingRows(app.rows).length, 0);
  assert.ok(app.failures.size);
  app.storageControl.failWrite = false;
  app.db.control.failAttempt = false;
  await app.window.CaatuuLearning.retry();
  assert.equal(app.db.stores.get("attempts").size, 1);
  assert.equal(app.failures.size, 0);
});

test("a committed attempt with failed fallback cleanup never scores again after ordinary receipts disappear", async () => {
  const app = browser();
  await app.api.whenIdle();
  app.storageControl.failRemove = true;
  await app.api.recordAttempt(attempt());
  assert.equal(app.db.control.commits, 1);
  assert.equal(pendingRows(app.rows).length, 1);
  app.db.stores.get("attempts").clear();
  app.db.stores.get("receipts").clear();
  const before = structuredClone(app.db.stores.get("evidence"));
  app.storageControl.failRemove = false;
  const reloaded = browser(app);
  await reloaded.api.whenIdle();
  assert.equal(app.db.control.commits, 1);
  assert.deepEqual(app.db.stores.get("evidence"), before);
  assert.equal(pendingRows(app.rows).length, 0);
});

test("reset fences off durable leftovers even when localStorage deletion fails", async () => {
  const app = browser();
  await app.api.whenIdle();
  app.db.control.failAttempt = true;
  await assert.rejects(app.api.recordAttempt(attempt()));
  app.storageControl.failRemove = true;
  await app.api.resetProgress();
  assert.equal(pendingRows(app.rows).length, 1);
  app.db.control.failAttempt = false;
  app.storageControl.failRemove = false;
  const reloaded = browser(app);
  await reloaded.api.whenIdle();
  assert.equal(app.db.stores.get("attempts").size, 0);
  assert.equal(pendingRows(app.rows).length, 0);
  await reloaded.api.recordAttempt(attempt("after-reset"));
  assert.equal(app.db.stores.get("attempts").size, 1);
});

test("an embedding-cache clear preserves pending learning attempts", async () => {
  const app = browser();
  await app.api.whenIdle();
  app.db.control.failAttempt = true;
  await assert.rejects(app.api.recordAttempt(attempt()));
  await app.api.clearEmbeddingCache();
  app.db.control.failAttempt = false;
  await app.api.retryPendingAttempts();
  assert.equal(app.db.stores.get("attempts").size, 1);
});

test("invalid raw input is quarantined without scoring and a conflicting id preserves the original pending event", async () => {
  const app = browser();
  await app.api.whenIdle();
  await assert.rejects(app.api.recordAttempt({ ...attempt("bad-answer"), signals: [] }));
  assert.equal(pendingRows(app.rows).length, 1);
  assert.equal(app.db.stores.get("attempts").size, 0);
  app.db.control.failAttempt = true;
  await assert.rejects(app.api.recordAttempt(attempt()));
  await assert.rejects(app.api.recordAttempt({ ...attempt(), itemId: "different" }), /different pending event/);
  assert.equal(JSON.parse(app.rows.get(`${prefix}answer-1`)).attempt.itemId, "verb:1");
  app.db.control.failAttempt = false;
  await app.api.retryPendingAttempts();
  assert.equal(app.db.stores.get("attempts").size, 1);
});

test("an answer survives immediate page closure before the reducer or any earlier asynchronous operation finishes", async () => {
  const first = browser({ coreReady: new Promise(() => {}) });
  const input = attempt();
  void first.api.recordAttempt(input);
  // No await/microtask has occurred since submitting the answer.
  assert.equal(pendingRows(first.rows).length, 1);
  const durable = new Map(first.rows);
  input.itemId = "mutated-after-submit";
  assert.equal(JSON.parse(durable.get(`${prefix}answer-1`)).attempt.itemId, "verb:1");
  const reloaded = browser({ rows: durable });
  await reloaded.api.whenIdle();
  assert.equal(reloaded.db.stores.get("attempts").size, 1);
  assert.equal(reloaded.db.stores.get("attempts").get("answer-1").itemId, "verb:1");
  assert.equal(pendingRows(durable).length, 0);
});

test("a transient outbox read failure remains retryable", async () => {
  const key = `${prefix}answer-1`;
  const rows = new Map([[key, JSON.stringify({ schemaVersion: 1, progressEpoch: "semantic-progress-epoch-0", attempt: attempt() })]]);
  const storageControl = { failReadKey: key };
  const app = browser({ rows, storageControl });
  await app.api.whenIdle();
  assert.ok(app.failures.has(key));
  assert.equal(app.db.stores.get("attempts").size, 0);
  storageControl.failReadKey = "";
  await app.api.retryPendingAttempts();
  assert.equal(app.db.stores.get("attempts").size, 1);
  assert.equal(app.failures.has(key), false);
});

test("an outbox row removed by another tab during enumeration is skipped without corruption warnings", async () => {
  const key = `${prefix}answer-1`;
  const rows = new Map([[key, JSON.stringify({ schemaVersion: 1, progressEpoch: "semantic-progress-epoch-0", attempt: attempt() })]]);
  const app = browser({ rows, storageControl: { onRead(readKey, stored) { if (readKey === key) stored.delete(key); } } });
  await app.api.whenIdle();
  assert.equal(app.failures.has(key), false);
  assert.equal(app.db.stores.get("attempts").size, 0);
});

test("malformed durable records are preserved and do not loop or block valid records", async () => {
  const rows = new Map([[`${prefix}broken`, "{bad json"]]);
  const app = browser({ rows });
  await app.api.whenIdle();
  assert.equal(rows.get(`${prefix}broken`), "{bad json");
  assert.ok(app.failures.has(`${prefix}broken`));
  await app.api.retryPendingAttempts();
  await app.api.recordAttempt(attempt());
  assert.equal(app.db.stores.get("attempts").size, 1);
});

test("a suspended second tab never recreates a pending row already committed by the first tab", async () => {
  const first = browser();
  await first.api.whenIdle();
  first.db.control.failAttempt = true;
  await assert.rejects(first.api.recordAttempt(attempt()));
  const second = browser(first);
  await second.api.whenIdle();
  first.db.control.failAttempt = false;
  await first.api.retryPendingAttempts();
  assert.equal(first.db.control.commits, 1);
  assert.equal(pendingRows(first.rows).length, 0);
  first.db.stores.get("attempts").clear();
  first.db.stores.get("receipts").clear();
  const evidence = structuredClone(first.db.stores.get("evidence"));
  await second.api.retryPendingAttempts();
  assert.equal(first.db.control.commits, 1);
  assert.deepEqual(first.db.stores.get("evidence"), evidence);
  assert.equal(pendingRows(first.rows).length, 0);
});

test("an oversized restored outbox drains in bounded batches without dropping or permanently blocking overflow", async () => {
  const rows = new Map(Array.from({ length: 129 }, (_, index) => {
    const input = attempt(`answer-${index}`);
    return [`${prefix}${input.id}`, JSON.stringify({ schemaVersion: 1, progressEpoch: "semantic-progress-epoch-0", attempt: core.normalizeSemanticAttempt(input) })];
  }));
  const app = browser({ rows });
  await app.api.whenIdle();
  assert.equal(app.db.stores.get("attempts").size, 128);
  assert.equal(pendingRows(rows).length, 1);
  await app.api.retryPendingAttempts();
  assert.equal(app.db.stores.get("attempts").size, 129);
  assert.equal(pendingRows(rows).length, 0);
});
