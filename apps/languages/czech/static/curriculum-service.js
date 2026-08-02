(() => {
  let service = null;
  let failure = null;

  const serviceLoading = import("./curriculum/curriculum-service.mjs?v=curriculum-service-9")
    .then(({ createCurriculumService }) => {
      service = createCurriculumService({ courseProfile: window.CaatuuCourse });
      return service;
    });
  const loading = serviceLoading
    .then((loadedService) => loadedService.ready())
    .then((result) => {
      window.dispatchEvent(new CustomEvent("caatuu:curriculum-status", {
        detail: { status: "ready", result }
      }));
      return result;
    })
    .catch((error) => {
      failure = error;
      window.dispatchEvent(new CustomEvent("caatuu:curriculum-status", {
        detail: {
          status: "failed",
          error: { code: error?.code || "CURRICULUM_RUNTIME_FAILED", message: error?.message || String(error) }
        }
      }));
      throw error;
    });

  const invoke = (method) => (...args) => loading.then(() => service[method](...args));
  const invokeWithoutReadiness = (method) => (...args) => (
    serviceLoading.then((loadedService) => loadedService[method](...args))
  );
  window.CaatuuCurriculum = Object.freeze({
    ready: () => loading,
    guidedModeEnabled: () => service?.guidedModeEnabled() === true,
    developerPilotModeEnabled: () => service?.developerPilotModeEnabled() === true,
    resolveBinding: invoke("resolveBinding"),
    issueTask: invoke("issueTask"),
    beginOpportunity: invoke("beginOpportunity"),
    recordEvidence: invoke("recordEvidence"),
    recordExposure: invoke("recordExposure"),
    claimDeveloperPilot: invoke("claimDeveloperPilot"),
    claimDeveloperPilotSequence: invoke("claimDeveloperPilotSequence"),
    completeDeveloperPilotStep: invoke("completeDeveloperPilotStep"),
    saveMorphologyRoundState: invoke("saveMorphologyRoundState"),
    restoreMorphologyRoundState: invoke("restoreMorphologyRoundState"),
    resetProgress: invokeWithoutReadiness("resetProgress"),
    skillSummary: invoke("skillSummary"),
    progression: invoke("progression"),
    nextRequest: invoke("nextRequest"),
    snapshot: () => service?.snapshot() || {
      status: failure ? "failed" : "loading",
      guidedModeEnabled: false,
      failure: failure ? { code: failure.code, message: failure.message } : null
    }
  });

  void loading.catch(() => {});
})();
