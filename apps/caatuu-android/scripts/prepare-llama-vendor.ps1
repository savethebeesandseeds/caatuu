$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$vendorDir = Join-Path $repoRoot "tools\phone-bench\vendor"
$llamaDir = Join-Path $vendorDir "llama.cpp"
$androidMinSdk = if ($env:CAATUU_ANDROID_MIN_SDK) { $env:CAATUU_ANDROID_MIN_SDK } else { "30" }

if (Test-Path (Join-Path $llamaDir "examples\llama.android\lib")) {
    Write-Host "llama.cpp Android library already exists at $llamaDir"
} else {
    New-Item -ItemType Directory -Force $vendorDir | Out-Null
    git clone --depth 1 https://github.com/ggml-org/llama.cpp.git $llamaDir
    Write-Host "llama.cpp Android library is ready at $llamaDir"
}

$libGradle = Join-Path $llamaDir "examples\llama.android\lib\build.gradle.kts"
if (Test-Path $libGradle) {
    $content = Get-Content -Raw $libGradle
    $content = $content -replace "minSdk = \d+", "minSdk = $androidMinSdk"
    Set-Content -NoNewline -Path $libGradle -Value $content
    Write-Host "llama.cpp Android library minSdk set to $androidMinSdk"
}
