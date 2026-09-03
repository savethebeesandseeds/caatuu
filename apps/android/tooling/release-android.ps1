[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedRepositoryRoot = [System.IO.Path]::GetFullPath("C:\Work\caatuu")
$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
if (-not [string]::Equals(
    $RepositoryRoot.TrimEnd('\'),
    $ExpectedRepositoryRoot.TrimEnd('\'),
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw "Run the Android release command only from the canonical Caatuu checkout at $ExpectedRepositoryRoot."
}

$ProductBuild = Join-Path $RepositoryRoot "apps\android\product\build.gradle.kts"
$ProductBuildText = [System.IO.File]::ReadAllText($ProductBuild)
$VersionMatch = [regex]::Match(
    $ProductBuildText,
    'caatuuVersionCode[\s\S]*?orElse\(([1-9][0-9]*)\)',
    [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
)
if (-not $VersionMatch.Success) {
    throw "Could not read the Caatuu versionCode from $ProductBuild."
}

$VersionCode = [int]$VersionMatch.Groups[1].Value
$FinalizedReleaseDirectory = Join-Path $RepositoryRoot "artifacts\android\releases\$VersionCode"
$FinalizedApk = Join-Path $FinalizedReleaseDirectory "caatuu.apk"
$FinalizedManifest = Join-Path $FinalizedReleaseDirectory "caatuu.json"
$FinalizedReceipt = Join-Path $FinalizedReleaseDirectory "caatuu-release-candidate.json"
$FinalizedReleaseComplete =
    (Test-Path -LiteralPath $FinalizedApk -PathType Leaf) -and
    (Test-Path -LiteralPath $FinalizedManifest -PathType Leaf) -and
    (Test-Path -LiteralPath $FinalizedReceipt -PathType Leaf)

if ($FinalizedReleaseComplete) {
    Write-Host "Found finalized Android $VersionCode receipt; skipping the build stage."
} else {
    Write-Host "Android $VersionCode is not completely finalized; running the guarded build-once stage."
    & docker exec --workdir /workspace caatuu-dev bash apps/android/tooling/publish-release.sh --build-once
    if ($LASTEXITCODE -ne 0) {
        throw "The guarded Android build/finalization stage failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path -LiteralPath $FinalizedApk -PathType Leaf) -or
    -not (Test-Path -LiteralPath $FinalizedManifest -PathType Leaf) -or
    -not (Test-Path -LiteralPath $FinalizedReceipt -PathType Leaf)) {
    throw "Android $VersionCode finished without its complete version-owned APK, manifest, and receipt."
}

Write-Host "Deploying only the exact bytes named by the finalized Android $VersionCode receipt."
& (Join-Path $PSScriptRoot "deploy-pages-release.ps1") -CandidateReceipt $FinalizedReceipt
