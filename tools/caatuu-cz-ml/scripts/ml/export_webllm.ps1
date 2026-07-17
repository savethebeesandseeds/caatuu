param(
  [string]$RunId = "qwen3-1.7b-lora-003-hard",
  [ValidateSet("merge", "mlc", "all", "status")]
  [string]$Stage = "all",
  [switch]$CompileWebgpu,
  [switch]$Cpu
)

$ErrorActionPreference = "Stop"

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = $env:CAATUU_ML_PYTHON

if (-not $python) {
  $python = "python"
}

$argsList = @(
  (Join-Path $toolRoot "export_webllm.py"),
  "--run-id", $RunId,
  "--stage", $Stage
)

if ($CompileWebgpu) {
  $argsList += "--compile-webgpu"
}

if ($Cpu) {
  $argsList += "--cpu"
}

& $python @argsList
exit $LASTEXITCODE
