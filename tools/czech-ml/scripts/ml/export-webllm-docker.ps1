param(
  [string]$RunId = "qwen3-1.7b-lora-003-hard",
  [string]$Image = "caatuu-mlc-webllm:py313-cpu"
)

$ErrorActionPreference = "Stop"

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$mlRoot = Resolve-Path (Join-Path $toolRoot "..\..")
$modelsRoot = Resolve-Path (Join-Path $mlRoot "data\models")
$dockerfile = Join-Path $toolRoot "Dockerfile.mlc-webllm"
$entrypoint = "/ml-tools/mlc_webllm_entrypoint.py"
$finalizer = Join-Path $mlRoot "scripts\finalize-webllm-export.mjs"

docker build -f $dockerfile -t $Image $mlRoot
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

docker run --rm `
  -v "${modelsRoot}:/models" `
  -v "${toolRoot}:/ml-tools:ro" `
  -w /models `
  $Image `
  python $entrypoint --run-id $RunId --skip-config

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

node $finalizer --run-id $RunId
exit $LASTEXITCODE
