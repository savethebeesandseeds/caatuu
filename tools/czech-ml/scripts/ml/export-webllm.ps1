param(
  [string]$RunId = "qwen3-1.7b-lora-003-hard",
  [ValidateSet("merge", "mlc", "all", "status")]
  [string]$Stage = "all",
  [switch]$CompileWebgpu,
  [switch]$Cpu
)

$ErrorActionPreference = "Stop"

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

$stages = if ($Stage -eq 'all') { @('merge', 'mlc') } else { @($Stage) }
foreach ($exportStage in $stages) {
  $python = if ($exportStage -eq 'mlc') { 'caatuu-mlc-python' } else { '/opt/caatuu-ml/bin/python' }
  $argsList = @(
    'exec', '-w', '/workspace/tools/czech-ml', 'caatuu-dev', $python,
    'scripts/ml/export_webllm.py', '--run-id', $RunId, '--stage', $exportStage
  )
  if ($CompileWebgpu) { $argsList += '--compile-webgpu' }
  if ($Cpu) { $argsList += '--cpu' }

  & docker @argsList
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
exit 0
