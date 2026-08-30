const env = {};
env.allowRemoteModels = false;
env.allowLocalModels = true;

export function localEmbeddingPipeline(pipeline, modelId) {
  return pipeline("feature-extraction", modelId, {
    local_files_only: true
  });
}
