(() => {
  const READY_PHASES = new Set([
    "ready",
    "cached",
    "verified",
    "model_ready",
    "vector_ready",
    "asset_ready",
    "browser_cached",
    "hash_verified"
  ]);

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value || 0)));
  }

  function messageMarksReady(message = {}) {
    if (message.ready === true || message.verified === true) return true;
    const phase = String(message.phase || "").trim().toLowerCase();
    return READY_PHASES.has(phase);
  }

  function artifactPercent(item = {}) {
    if (item.ready) return 100;
    const expectedBytes = Number(item.expectedBytes || 0);
    const bytes = Number(item.bytes || 0);
    if (expectedBytes <= 0) return 0;
    return Math.min(99, clampPercent(bytes / expectedBytes * 100));
  }

  function totalsFromArtifacts(input = [], { setupReady } = {}) {
    const rows = Array.from(input || []);
    const expectedBytes = rows.reduce((sum, item) => sum + Number(item.expectedBytes || 0), 0);
    const bytes = rows.reduce((sum, item) => {
      const current = Number(item.bytes || 0);
      const expected = Number(item.expectedBytes || current || 0);
      return sum + Math.min(current, expected);
    }, 0);
    const readyArtifacts = rows.filter((item) => item.ready).length;
    const artifactCount = rows.length;
    const allReady = artifactCount > 0 && readyArtifacts === artifactCount;
    const complete = setupReady === undefined ? allReady : Boolean(setupReady) && allReady;
    const rawProgress = expectedBytes > 0
      ? bytes / expectedBytes * 100
      : artifactCount > 0
        ? readyArtifacts / artifactCount * 100
        : 0;
    const progress = complete ? 100 : Math.min(99, clampPercent(rawProgress));
    const verifyingArtifacts = rows.filter((item) => {
      if (item.ready) return false;
      const expected = Number(item.expectedBytes || 0);
      return expected > 0 && Number(item.bytes || 0) >= expected;
    }).length;

    return {
      bytes,
      expectedBytes,
      readyArtifacts,
      artifactCount,
      allReady,
      complete,
      rawProgress,
      progress,
      verifying: verifyingArtifacts > 0,
      verifyingArtifacts,
      remainingArtifacts: Math.max(0, artifactCount - readyArtifacts)
    };
  }

  window.CaatuuSetupProgress = Object.freeze({
    clampPercent,
    messageMarksReady,
    artifactPercent,
    totalsFromArtifacts
  });
})();
