param(
  [string]$RunId = "qwen3-1.7b-lora-003-hard",
  [string]$Image
)

$ErrorActionPreference = "Stop"

if ($PSBoundParameters.ContainsKey('Image')) {
  throw '-Image is retired. This wrapper uses the existing caatuu-dev container.'
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
if ($repoRoot -ne 'C:\Work\caatuu') {
  throw 'Run this wrapper from the canonical C:\Work\caatuu checkout.'
}
$containerJson = docker inspect caatuu-dev
if ($LASTEXITCODE -ne 0) { throw 'The existing caatuu-dev container is unavailable.' }
$container = @($containerJson | ConvertFrom-Json)[0]
$workspaceMount = @($container.Mounts | Where-Object { $_.Destination -eq '/workspace' })
if (-not $container.State.Running -or $workspaceMount.Count -ne 1 -or
    $workspaceMount[0].Type -ne 'bind' -or
    [IO.Path]::GetFullPath($workspaceMount[0].Source) -ne $repoRoot) {
  throw 'caatuu-dev must be running with C:\Work\caatuu bound to /workspace.'
}

docker exec -w /workspace/tools/czech-ml caatuu-dev `
  caatuu-mlc-python scripts/ml/mlc_webllm_entrypoint.py --run-id $RunId --skip-config

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

docker exec -w /workspace/tools/czech-ml caatuu-dev `
  node scripts/finalize-webllm-export.mjs --run-id $RunId
exit $LASTEXITCODE
