export function activeGenerationModels(models = []) {
  return models.filter(model => model && typeof model.key === "string" && model.key
    && (model.status || "active") === "active" && !model.deprecated
    && (model.modelFile || model.model_file)
    && (model.artifactKind || model.artifact_kind) !== "embedding-vector-db"
    && model.format !== "sqlite");
}

export function defaultGenerationModelKey(catalog = {}) {
  const models = activeGenerationModels(catalog.models);
  const declared = catalog.default_model || catalog.defaultModelKey || "";
  return models.find(model => model.key === declared)?.key || models[0]?.key || "";
}
