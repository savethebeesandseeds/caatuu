import assert from "node:assert/strict";
import test from "node:test";

import {
  FeedbackOutbox,
  feedbackDedupeKey
} from "../../../../apps/languages/czech/static/feedback-outbox.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

test("feedback outbox persists before delivery and removes only after acknowledgement", async () => {
  const storage = memoryStorage();
  let now = 1_000;
  let attempts = 0;
  const queue = new FeedbackOutbox({
    storage,
    now: () => now,
    random: () => 0.5,
    retryDelaysMs: [100],
    idFactory: () => "report-1",
    send: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return { ok: true };
    }
  });

  queue.enqueue({ feedback: { sentence: "Pes spí." } });
  assert.equal(queue.list().length, 1);
  await queue.flush();
  assert.equal(queue.list()[0].attempts, 1);

  const restored = new FeedbackOutbox({
    storage,
    now: () => now,
    random: () => 0.5,
    retryDelaysMs: [100],
    send: async () => ({ ok: true })
  });
  assert.equal(restored.list().length, 1);
  now += 100;
  const result = await restored.flush();
  assert.deepEqual(result.sent, ["report-1"]);
  assert.equal(restored.list().length, 0);
});

test("feedback outbox coalesces duplicate phrases and pauses gently", async () => {
  const queue = new FeedbackOutbox({
    storage: memoryStorage(),
    online: () => false,
    send: async () => ({ ok: true }),
    idFactory: () => "report-2"
  });
  const key = feedbackDedupeKey({ kind: "word_world_sentence", sentence: "Kočka spí.", reason: "nonsense" });
  assert.equal(queue.enqueue({ value: 1 }, { dedupeKey: key }).duplicate, false);
  assert.equal(queue.enqueue({ value: 2 }, { dedupeKey: key }).duplicate, true);
  assert.equal(queue.list().length, 1);
  assert.equal((await queue.flush()).paused, true);
});

test("feedback outbox keeps a single delivery in flight", async () => {
  let resolveSend;
  let calls = 0;
  const queue = new FeedbackOutbox({
    storage: memoryStorage(),
    idFactory: () => "report-3",
    send: () => {
      calls += 1;
      return new Promise((resolve) => { resolveSend = resolve; });
    }
  });
  queue.enqueue({ value: 1 });
  const first = queue.flush();
  const second = queue.flush();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveSend({ ok: true });
  await first;
});

test("feedback outbox reports when an item is memory-only", () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error("storage disabled"); }
  };
  const queue = new FeedbackOutbox({
    storage,
    idFactory: () => "report-memory",
    send: async () => ({ ok: true })
  });

  const result = queue.enqueue({ value: 1 });
  assert.equal(result.queued, true);
  assert.equal(result.persisted, false);
  assert.equal(queue.list().length, 1);

  const restored = new FeedbackOutbox({ storage, send: async () => ({ ok: true }) });
  assert.equal(restored.list().length, 0);
});

test("feedback outbox never evicts an accepted in-flight item", async () => {
  let rejectSend;
  const queue = new FeedbackOutbox({
    storage: memoryStorage(),
    maxItems: 1,
    idFactory: () => "report-active",
    send: () => new Promise((resolve, reject) => { rejectSend = reject; })
  });

  assert.equal(queue.enqueue({ value: "A" }).queued, true);
  const flushing = queue.flush();
  const overflow = queue.enqueue({ value: "B" });
  assert.equal(overflow.queued, false);
  assert.equal(overflow.full, true);
  rejectSend(new Error("offline"));
  await flushing;
  assert.equal(queue.list().length, 1);
  assert.equal(queue.list()[0].payload.value, "A");
  assert.equal(queue.list()[0].attempts, 1);
});

test("feedback outbox requires an explicit positive acknowledgement", async () => {
  for (const acknowledgement of [undefined, {}]) {
    const queue = new FeedbackOutbox({
      storage: memoryStorage(),
      idFactory: () => "report-unacknowledged",
      retryDelaysMs: [100],
      random: () => 0.5,
      send: async () => acknowledgement
    });
    queue.enqueue({ value: 1 });
    const result = await queue.flush();
    assert.equal(result.sent.length, 0);
    assert.equal(queue.list().length, 1);
    assert.equal(queue.list()[0].attempts, 1);
  }
});

test("feedback outbox bases backoff on failure time", async () => {
  let now = 1_000;
  const queue = new FeedbackOutbox({
    storage: memoryStorage(),
    now: () => now,
    retryDelaysMs: [100],
    random: () => 0.5,
    send: async () => {
      now = 5_000;
      throw new Error("slow offline failure");
    }
  });
  queue.enqueue({ value: 1 });
  await queue.flush();
  assert.equal(queue.list()[0].nextAttemptAt, 5_100);
  assert.equal(queue.nextDelayMs(), 100);
});

test("feedback outbox stores separate items without cross-tab overwrites", () => {
  const storage = memoryStorage();
  const first = new FeedbackOutbox({ storage, idFactory: () => "report-a", send: async () => ({ ok: true }) });
  const second = new FeedbackOutbox({ storage, idFactory: () => "report-b", send: async () => ({ ok: true }) });
  first.enqueue({ value: "A" });
  second.enqueue({ value: "B" });

  const restored = new FeedbackOutbox({ storage, send: async () => ({ ok: true }) });
  assert.deepEqual(restored.list().map((item) => item.payload.value).sort(), ["A", "B"]);
});

test("feedback outbox isolates malformed per-item records", () => {
  const storage = memoryStorage();
  storage.setItem("caatuu.feedbackOutbox.v1.item.corrupt", "{not-json");
  storage.setItem("caatuu.feedbackOutbox.v1.item.valid", JSON.stringify({
    id: "valid",
    payload: { value: "kept" },
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0
  }));

  const queue = new FeedbackOutbox({ storage, send: async () => ({ ok: true }) });
  assert.deepEqual(queue.list().map((item) => item.id), ["valid"]);
});
