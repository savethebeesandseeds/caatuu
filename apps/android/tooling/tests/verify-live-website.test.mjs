import assert from "node:assert/strict";
import test from "node:test";
import { verifyLiveWebsite } from "../verify-live-website.mjs";

const expectedRevision = "a".repeat(40);
const inventory = (revision) => new Response(JSON.stringify({ websiteSnapshot: { sourceRevision: revision } }));

function scenario(responses, options = {}) {
  const requests = [];
  const sleeps = [];
  return {
    requests,
    sleeps,
    run: () => verifyLiveWebsite({
      expectedRevision,
      publicOrigin: "https://example.test/",
      attempts: responses.length,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        const response = responses[requests.length - 1];
        if (response instanceof Error) throw response;
        return response;
      },
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      ...options,
    }),
  };
}

test("publication succeeds only when the public inventory identifies the expected source", async () => {
  const value = scenario([inventory(expectedRevision)]);
  assert.deepEqual(await value.run(), { verified: true, sourceRevision: expectedRevision, attempts: 1 });
  assert.equal(value.requests[0].url, "https://example.test/caatuu-web-bundle.json");
  assert.equal(value.requests[0].init.cache, "no-store");
  assert.ok(value.requests[0].init.signal instanceof AbortSignal);
  assert.deepEqual(value.sleeps, []);
});

test("delayed publication and transient transport failures recover without another deployment", async () => {
  const value = scenario([
    inventory("b".repeat(40)),
    new Error("connection reset"),
    new Response("unavailable", { status: 503 }),
    new Response("not JSON"),
    inventory(expectedRevision),
  ]);
  assert.equal((await value.run()).attempts, 5);
  assert.deepEqual(value.sleeps, [20_000, 20_000, 20_000, 20_000]);
});

test("an old or unversioned public site fails after bounded retries", async () => {
  for (const response of [() => inventory("b".repeat(40)), () => new Response("{}")]) {
    const value = scenario([response(), response(), response()]);
    await assert.rejects(value.run(), /does not match.*after 3 attempts/);
    assert.equal(value.requests.length, 3);
    assert.equal(value.sleeps.length, 2);
  }
});

test("unavailable inventory cannot be mistaken for a successful deployment", async () => {
  const value = scenario([new Response("unavailable", { status: 502 })]);
  await assert.rejects(value.run(), /HTTP 502/);
  assert.deepEqual(value.sleeps, []);
});

test("invalid publication inputs fail before any request", async () => {
  for (const options of [{ expectedRevision: "main" }, { publicOrigin: "http://example.test" }, { attempts: 0 }, { attempts: 32 }]) {
    const value = scenario([], options);
    await assert.rejects(value.run());
    assert.equal(value.requests.length, 0);
  }
});

test("the default retry window accommodates ten minutes of edge propagation", async () => {
  const value = scenario(Array.from({ length: 31 }, () => inventory("b".repeat(40))), { attempts: undefined });
  await assert.rejects(value.run(), /after 31 attempts/);
  assert.equal(value.sleeps.reduce((total, delay) => total + delay, 0), 600_000);
});

test("a body that stalls after successful headers is aborted and retried", async () => {
  let requests = 0;
  await assert.rejects(verifyLiveWebsite({
    expectedRevision,
    attempts: 2,
    requestTimeoutMs: 5,
    sleep: async () => {},
    fetchImpl: async (_url, { signal }) => {
      requests++;
      return {
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          const watchdog = setTimeout(() => reject(new Error("body did not abort")), 1000);
          signal.addEventListener("abort", () => {
            clearTimeout(watchdog);
            reject(signal.reason);
          }, { once: true });
        }),
      };
    },
  }), /after 2 attempts:.*timeout/i);
  assert.equal(requests, 2);
});
