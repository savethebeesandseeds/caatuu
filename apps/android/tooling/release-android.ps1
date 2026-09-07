[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "release-orchestration.psm1") -Force

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
$ReadFinalizedState = {
    return (Test-Path -LiteralPath $FinalizedApk -PathType Leaf) -and
        (Test-Path -LiteralPath $FinalizedManifest -PathType Leaf) -and
        (Test-Path -LiteralPath $FinalizedReceipt -PathType Leaf)
}.GetNewClosure()
$BuildStage = {
    & docker exec --workdir /workspace caatuu-dev bash apps/android/tooling/publish-release.sh --build-once
    if ($LASTEXITCODE -ne 0) {
        throw "The guarded Android build/finalization stage failed with exit code $LASTEXITCODE."
    }
}
$Deployer = Join-Path $PSScriptRoot "deploy-pages-release.ps1"
$DeployStage = {
    param([string]$Receipt)
    & $Deployer -CandidateReceipt $Receipt
}.GetNewClosure()
Invoke-CaatuuReleasePipeline -VersionCode $VersionCode -CandidateReceipt $FinalizedReceipt `
    -ReadFinalizedState $ReadFinalizedState -BuildStage $BuildStage -DeployStage $DeployStage
