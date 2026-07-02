$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$vendorDir = Join-Path $repoRoot "tools\phone-bench\vendor"
$llamaDir = Join-Path $vendorDir "llama.cpp"

if (Test-Path (Join-Path $llamaDir "examples\llama.android\lib")) {
    Write-Host "llama.cpp Android library already exists at $llamaDir"
    exit 0
}

New-Item -ItemType Directory -Force $vendorDir | Out-Null
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git $llamaDir
Write-Host "llama.cpp Android library is ready at $llamaDir"
