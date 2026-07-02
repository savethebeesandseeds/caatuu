$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$vendorDir = Join-Path $repoRoot "tools\phone-bench\vendor"
$llamaDir = Join-Path $vendorDir "llama.cpp"
$androidMinSdk = if ($env:CAATUU_ANDROID_MIN_SDK) { $env:CAATUU_ANDROID_MIN_SDK } else { "30" }
$patchFile = Join-Path $repoRoot "apps\caatuu-android\patches\llama-android-thinking.patch"

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

if (Test-Path $patchFile) {
    & git -C $llamaDir apply --reverse --check $patchFile 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "llama.cpp Android thinking patch already applied"
    } else {
        & git -C $llamaDir apply $patchFile
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to apply llama.cpp Android thinking patch"
        }
        Write-Host "llama.cpp Android thinking patch applied"
    }
}
