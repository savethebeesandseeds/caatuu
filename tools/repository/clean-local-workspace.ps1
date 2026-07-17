[CmdletBinding()]
param(
    [switch]$Execute,
    [switch]$IncludeDownloads
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$repoPrefix = $repoRoot.TrimEnd('\') + '\'

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
    throw "Repository root was not found at $repoRoot"
}

$targets = @(
    @{ Path = 'apps/animated-fabric/.mypy_cache'; Reason = 'Python type-check cache' }
    @{ Path = 'apps/animated-fabric/.pytest_cache'; Reason = 'Python test cache' }
    @{ Path = 'apps/animated-fabric/.ruff_cache'; Reason = 'Python lint cache' }
    @{ Path = 'apps/animated-fabric/.tmp'; Reason = 'Temporary test and render output' }
    @{ Path = 'apps/animated-fabric/build'; Reason = 'Generated application build' }
    @{ Path = 'apps/android/.gradle'; Reason = 'Gradle cache' }
    @{ Path = 'apps/android/.kotlin'; Reason = 'Kotlin cache' }
    @{ Path = 'apps/android/app/.cxx'; Reason = 'Android native build cache' }
    @{ Path = 'apps/android/app/build'; Reason = 'Android build output' }
    @{ Path = 'apps/languages/czech/dumps'; Reason = 'Generated diagnostics' }
    @{ Path = 'apps/runtime/target'; Reason = 'Rust build output' }
    @{ Path = 'apps/runtime/target-linux'; Reason = 'Rust Linux build output' }
    @{ Path = 'tools/czech-ml/node_modules'; Reason = 'Node dependency tree' }
    @{ Path = 'tools/czech-ml/data/models/tools/__pycache__'; Reason = 'Python bytecode cache' }
    @{ Path = 'tools/czech-ml/scripts/__pycache__'; Reason = 'Python bytecode cache' }
    @{ Path = 'tools/czech-ml/scripts/ml/__pycache__'; Reason = 'Python bytecode cache' }
    @{ Path = 'tools/on-device-models/scripts/__pycache__'; Reason = 'Python bytecode cache' }
    @{ Path = 'archive/local/caatuu-server/target'; Reason = 'Archived Rust build output' }
    @{ Path = 'archive/local/caatuu-server/.git'; Reason = 'Nested repository metadata' }
    @{ Path = 'archive/local/caatuu-tauri-android/.git'; Reason = 'Nested repository metadata' }
    @{ Path = 'archive/local/caatuu-tauri-android/target'; Reason = 'Archived Rust build output' }
    @{ Path = 'archive/local/caatuu-tauri-android/src-tauri/gen/android/.gradle'; Reason = 'Archived Gradle cache' }
    @{ Path = 'archive/local/caatuu-tauri-android/src-tauri/gen/android/build'; Reason = 'Archived Android build output' }
    @{ Path = 'archive/local/caatuu-tauri-android/src-tauri/gen/android/buildSrc/.gradle'; Reason = 'Archived Gradle cache' }
    @{ Path = 'archive/local/caatuu-tauri-android/src-tauri/gen/android/buildSrc/.kotlin'; Reason = 'Archived Kotlin cache' }
    @{ Path = 'archive/local/caatuu-tauri-android/src-tauri/gen/android/buildSrc/build'; Reason = 'Archived build output' }
    @{ Path = 'archive/local/caatuu-tauri-android/src-tauri/gen/android/app/build'; Reason = 'Archived Android build output' }
    @{ Path = 'archive/local/caatuu-tauri-android/src-tauri/plugins/speech/android/.tauri'; Reason = 'Archived Tauri cache' }
    @{ Path = 'archive/local/caatuu-tauri-android/src-tauri/plugins/speech/android/build'; Reason = 'Archived Android build output' }
)

if ($IncludeDownloads) {
    $targets += @(
        @{ Path = 'tools/czech-ml/data/dictionaries/downloads'; Reason = 'Replaceable dictionary downloads' }
        @{ Path = 'tools/czech-ml/data/models/english-base/hf-cache'; Reason = 'Hugging Face download cache' }
        @{ Path = 'tools/on-device-models/artifacts'; Reason = 'Duplicated benchmark artifacts' }
        @{ Path = 'tools/on-device-models/vendor'; Reason = 'Reproducible patched dependency checkout' }
    )
}

function Get-PathSize {
    param([Parameter(Mandatory)][string]$LiteralPath)

    $item = Get-Item -LiteralPath $LiteralPath -Force
    if (-not $item.PSIsContainer) {
        return [int64]$item.Length
    }

    $sum = (Get-ChildItem -LiteralPath $LiteralPath -File -Force -Recurse -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if ($null -eq $sum) { return [int64]0 }
    return [int64]$sum
}

function Remove-CleanTarget {
    param([Parameter(Mandatory)][string]$LiteralPath)

    $item = Get-Item -LiteralPath $LiteralPath -Force
    $robocopy = Get-Command robocopy.exe -ErrorAction SilentlyContinue
    if (-not $item.PSIsContainer -or -not $robocopy) {
        Remove-Item -LiteralPath $LiteralPath -Recurse -Force
        return
    }

    # Windows PowerShell 5 cannot reliably traverse Android/CMake paths over
    # MAX_PATH. Mirroring an empty directory uses robocopy's long-path support
    # while keeping both paths inside the already validated repository root.
    $emptyPath = Join-Path $repoRoot ".caatuu-cleanup-empty-$PID"
    if (Test-Path -LiteralPath $emptyPath) {
        throw "Temporary cleanup path already exists: $emptyPath"
    }

    New-Item -ItemType Directory -Path $emptyPath | Out-Null
    try {
        & $robocopy.Source $emptyPath $LiteralPath /MIR /XJ /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
        $exitCode = $LASTEXITCODE
        if ($exitCode -gt 7) {
            throw "robocopy failed for $LiteralPath with exit code $exitCode"
        }
        Remove-Item -LiteralPath $LiteralPath -Force
    }
    finally {
        if (Test-Path -LiteralPath $emptyPath) {
            Remove-Item -LiteralPath $emptyPath -Force
        }
    }
}

$existing = foreach ($target in $targets) {
    $candidate = Join-Path $repoRoot $target.Path
    if (-not (Test-Path -LiteralPath $candidate)) { continue }

    $item = Get-Item -LiteralPath $candidate -Force
    $resolved = [IO.Path]::GetFullPath($item.FullName)
    if ($resolved -eq $repoRoot -or
        -not $resolved.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing path outside the repository: $resolved"
    }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing reparse point: $resolved"
    }

    [pscustomobject]@{
        RelativePath = $target.Path
        FullPath = $resolved
        Reason = $target.Reason
        Bytes = Get-PathSize -LiteralPath $resolved
    }
}

if (-not $existing) {
    Write-Host 'No known local build, cache, or download directories were found.'
    exit 0
}

$totalBytes = ($existing | Measure-Object -Property Bytes -Sum).Sum
$existing | Sort-Object RelativePath | Format-Table RelativePath, Reason, @{ Label = 'GiB'; Expression = { '{0:N2}' -f ($_.Bytes / 1GB) } } -AutoSize
Write-Host ('Total: {0:N2} GiB' -f ($totalBytes / 1GB))

if (-not $Execute) {
    Write-Host 'Preview only. Add -Execute to remove these directories.'
    exit 0
}

foreach ($target in $existing) {
    Write-Host "Removing $($target.RelativePath)"
    Remove-CleanTarget -LiteralPath $target.FullPath
}

Write-Host ('Removed {0} local directories ({1:N2} GiB).' -f $existing.Count, ($totalBytes / 1GB))
