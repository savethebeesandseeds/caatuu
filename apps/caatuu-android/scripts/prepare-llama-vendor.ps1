$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$versionsFile = Join-Path $repoRoot "tools\android-build\versions.env"
$versionsText = Get-Content -Raw $versionsFile
$commitMatch = [regex]::Match(
    $versionsText,
    '(?m)^LLAMA_CPP_COMMIT="\$\{LLAMA_CPP_COMMIT:-([0-9a-f]{40})\}"\r?$'
)
if (-not $commitMatch.Success) {
    throw "Unable to read the pinned LLAMA_CPP_COMMIT from $versionsFile"
}
$llamaCommit = if ($env:LLAMA_CPP_COMMIT) { $env:LLAMA_CPP_COMMIT } else { $commitMatch.Groups[1].Value }
if ($llamaCommit -cnotmatch '^[0-9a-f]{40}$') {
    throw "LLAMA_CPP_COMMIT must be a full 40-character lowercase Git commit hash."
}

$vendorDir = Join-Path $repoRoot "tools\phone-bench\vendor"
$llamaDir = Join-Path $vendorDir "llama.cpp"
$llamaRemote = "https://github.com/ggml-org/llama.cpp.git"
$androidMinSdk = if ($env:CAATUU_ANDROID_MIN_SDK) { $env:CAATUU_ANDROID_MIN_SDK } else { "30" }
$androidAbisRaw = if ($env:CAATUU_ANDROID_ABIS) { $env:CAATUU_ANDROID_ABIS } else { "arm64-v8a" }
$supportedAbis = @("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
$androidAbis = @($androidAbisRaw.Split(",") | ForEach-Object { $_.Trim() })
if ($androidAbis.Count -eq 0 -or ($androidAbis | Where-Object { $_ -notin $supportedAbis }).Count -gt 0) {
    throw "CAATUU_ANDROID_ABIS must be a comma-separated list of supported Android ABIs."
}
$abiList = ($androidAbis | ForEach-Object { '"' + $_ + '"' }) -join ", "
$patchFile = Join-Path $repoRoot "apps\caatuu-android\patches\llama-android-thinking.patch"

if ((Test-Path $llamaDir) -and -not (Test-Path (Join-Path $llamaDir ".git"))) {
    throw "Existing llama.cpp vendor path is not a Git checkout: $llamaDir"
}

if (-not (Test-Path (Join-Path $llamaDir ".git"))) {
    New-Item -ItemType Directory -Force $vendorDir | Out-Null
    & git init $llamaDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to initialize llama.cpp vendor checkout."
    }
}

# Windows does not preserve Unix executable bits in this checkout. Ignoring those
# metadata-only changes keeps the dirty-tree safety check focused on file content.
& git -C $llamaDir config core.fileMode false
if ($LASTEXITCODE -ne 0) {
    throw "Failed to configure the llama.cpp vendor checkout."
}

$currentCommit = (& git -C $llamaDir rev-parse --verify HEAD 2>$null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0) {
    $currentCommit = ""
}
if ($currentCommit -ne $llamaCommit) {
    if ($currentCommit) {
        $dirtyFiles = @(& git -C $llamaDir status --porcelain --untracked-files=normal)
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to inspect the existing llama.cpp checkout."
        }
        if ($dirtyFiles.Count -gt 0) {
            throw "Refusing to replace dirty llama.cpp checkout at $currentCommit; expected $llamaCommit. Preserve or remove the local changes, then run this script again."
        }
    }

    & git -C $llamaDir fetch --depth 1 $llamaRemote $llamaCommit
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to fetch pinned llama.cpp commit $llamaCommit."
    }
    $fetchedCommit = (& git -C $llamaDir rev-parse FETCH_HEAD | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or $fetchedCommit -ne $llamaCommit) {
        throw "Fetched llama.cpp commit $fetchedCommit, expected $llamaCommit."
    }
    & git -C $llamaDir checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to check out pinned llama.cpp commit $llamaCommit."
    }
}

$currentCommit = (& git -C $llamaDir rev-parse HEAD | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $currentCommit -ne $llamaCommit) {
    throw "llama.cpp checkout verification failed: got $currentCommit, expected $llamaCommit."
}
Write-Host "llama.cpp is pinned at $llamaCommit"

if (-not (Test-Path (Join-Path $llamaDir "examples\llama.android\lib"))) {
    throw "Pinned llama.cpp checkout does not contain the Android library: $llamaDir"
}

$libGradle = Join-Path $llamaDir "examples\llama.android\lib\build.gradle.kts"
if (Test-Path $libGradle) {
    $content = Get-Content -Raw $libGradle
    $content = $content -replace "minSdk = \d+", "minSdk = $androidMinSdk"
    $content = $content -replace 'abiFilters\s*\+=\s*listOf\([^)]*\)', "abiFilters += listOf($abiList)"
    if ($content -notmatch [regex]::Escape("abiFilters += listOf($abiList)")) {
        throw "Could not configure llama.cpp Android ABI filters."
    }
    Set-Content -NoNewline -Path $libGradle -Value $content
    Write-Host "llama.cpp Android library minSdk set to $androidMinSdk"
    Write-Host "llama.cpp Android library ABIs set to $androidAbisRaw"
}

if (Test-Path $patchFile) {
    & git -C $llamaDir apply --reverse --check $patchFile 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "llama.cpp Android thinking patch already applied"
    } else {
        & git -C $llamaDir apply --check $patchFile 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "llama.cpp Android thinking patch neither applies cleanly nor matches the current checkout."
        }
        & git -C $llamaDir apply $patchFile
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to apply llama.cpp Android thinking patch"
        }
        Write-Host "llama.cpp Android thinking patch applied"
    }
}

$finalCommit = (& git -C $llamaDir rev-parse HEAD | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $finalCommit -ne $llamaCommit) {
    throw "llama.cpp HEAD changed while applying the Android overlay."
}
