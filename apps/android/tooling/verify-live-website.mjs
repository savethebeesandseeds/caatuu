import { pathToFileURL } from "node:url";

export async function verifyLiveWebsite({
  expectedRevision,
  publicOrigin = "https://caatuu.waajacu.com",
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  attempts = 31,
  delayMs = 20_000,
  requestTimeoutMs = 10_000,
} = {}) {
  if (!/^[a-f0-9]{40}$/.test(expectedRevision ?? "")) {
    throw new Error("An exact website source revision is required.");
  }
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new Error("Website verification requires a public HTTPS origin.");
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 31) {
    throw new Error("Website verification requires between 1 and 31 attempts.");
  }
  const url = new URL("caatuu-web-bundle.json", `${origin.href.replace(/\/$/, "")}/`);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: { "Cache-Control": "no-cache" },
        cache: "no-store",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) throw new Error(`Website inventory returned HTTP ${response.status}.`);
      const inventory = await response.json();
      const actualRevision = inventory?.websiteSnapshot?.sourceRevision;
      if (actualRevision !== expectedRevision) {
        throw new Error(`Live website revision is ${actualRevision ?? "missing"}.`);
      }
      return { verified: true, sourceRevision: actualRevision, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`Live website does not match ${expectedRevision} after ${attempts} attempts: ${lastError?.message}`, { cause: lastError });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await verifyLiveWebsite({
      expectedRevision: process.env.EXPECTED_REVISION,
      publicOrigin: process.env.PUBLIC_ORIGIN || undefined,
    })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
