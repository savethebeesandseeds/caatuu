[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "../release-orchestration.psm1") -Force

function Assert-Equal($Actual, $Expected, [string]$Because) {
    if ($Actual -cne $Expected) { throw "$Because (actual=$Actual; expected=$Expected)" }
}
function Assert-Fails([scriptblock]$Action, [string]$Pattern) {
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        return
    }
    throw "Expected operation to fail: $Pattern"
}
function New-Scenario {
    param([bool]$Complete = $false)
    $state = [pscustomobject]@{
        Complete = $Complete; BuildCalls = 0; DeployCalls = 0; SourceCheckCalls = 0; SourceFailure = $false
        BuildFailure = $false; LeaveIncomplete = $false; FailurePoint = ""
        UploadedApk = ""; PublishedApk = ""; Apk = "sealed-apk-identity"
        ReceivedReceipt = ""; PublicVerified = $false
    }
    return @{
        State = $state
        Arguments = @{
            VersionCode = 166
            CandidateReceipt = "version-owned/166/caatuu-release-candidate.json"
            ReadFinalizedState = { return $state.Complete }.GetNewClosure()
            SourceCheckStage = {
                $state.SourceCheckCalls++
                if ($state.SourceFailure) { throw "source CI failed" }
            }.GetNewClosure()
            BuildStage = {
                if ($state.SourceCheckCalls -lt 1) { throw "Build started before source checks." }
                $state.BuildCalls++
                if ($state.BuildFailure) { throw "build failed" }
                if (-not $state.LeaveIncomplete) { $state.Complete = $true }
            }.GetNewClosure()
            DeployStage = {
                param($Receipt)
                $state.DeployCalls++
                $state.ReceivedReceipt = $Receipt
                if ($state.FailurePoint -eq "receipt") { throw "receipt hash mismatch" }
                $state.UploadedApk = $state.Apk
                if ($state.FailurePoint -eq "upload") { throw "upload response interrupted" }
                if ($state.FailurePoint -eq "pages") { throw "Pages deployment failed" }
                $state.PublishedApk = $state.UploadedApk
                if ($state.FailurePoint -eq "verification") { throw "public verification failed" }
                $state.PublicVerified = $true
                return [pscustomobject]@{ deployed = $true; versionCode = 166 }
            }.GetNewClosure()
        }
    }
}
function Invoke-Scenario($Scenario) {
    $arguments = $Scenario.Arguments
    Invoke-CaatuuReleasePipeline @arguments 6>$null
}

$scenario = New-Scenario
$result = Invoke-Scenario $scenario
Assert-Equal $scenario.State.BuildCalls 1 "New release builds once"
Assert-Equal $scenario.State.SourceCheckCalls 1 "New release checks source before building"
Assert-Equal $scenario.State.DeployCalls 1 "New release deploys once"
Assert-Equal $scenario.State.PublishedApk $scenario.State.Apk "Publication uses the sealed identity"
Assert-Equal $scenario.State.ReceivedReceipt $scenario.Arguments.CandidateReceipt "Receipt identity reaches deployment"
Assert-Equal $result.deployed $true "Successful public verification returns success"

$scenario = New-Scenario -Complete $true
$null = Invoke-Scenario $scenario
Assert-Equal $scenario.State.BuildCalls 0 "Finalized release never enters the builder"
Assert-Equal $scenario.State.SourceCheckCalls 0 "Receipt-only retries never wait for source CI"

$scenario = New-Scenario
$scenario.State.SourceFailure = $true
Assert-Fails { Invoke-Scenario $scenario } "source CI failed"
Assert-Equal $scenario.State.BuildCalls 0 "Failed source checks prevent an APK build"
Assert-Equal $scenario.State.DeployCalls 0 "Failed source checks prevent publication"

$scenario = New-Scenario
$scenario.State.BuildFailure = $true
Assert-Fails { Invoke-Scenario $scenario } "build failed"
Assert-Equal $scenario.State.DeployCalls 0 "Build failure cannot reach publication"

$scenario = New-Scenario
$scenario.State.LeaveIncomplete = $true
Assert-Fails { Invoke-Scenario $scenario } "without its complete"
Assert-Equal $scenario.State.DeployCalls 0 "Incomplete finalization cannot reach publication"

foreach ($failurePoint in @("upload", "pages", "verification")) {
    $scenario = New-Scenario
    $scenario.State.FailurePoint = $failurePoint
    Assert-Fails { Invoke-Scenario $scenario } "interrupted|failed"
    Assert-Equal $scenario.State.PublicVerified $false "Failure is not reported as verified publication"
    $sealedIdentity = $scenario.State.Apk
    $scenario.State.FailurePoint = ""
    $null = Invoke-Scenario $scenario
    Assert-Equal $scenario.State.BuildCalls 1 "$failurePoint retry must not rebuild"
    Assert-Equal $scenario.State.DeployCalls 2 "$failurePoint retry resumes deployment"
    Assert-Equal $scenario.State.PublishedApk $sealedIdentity "$failurePoint retry keeps exact bytes"
}

$scenario = New-Scenario -Complete $true
$scenario.State.FailurePoint = "receipt"
Assert-Fails { Invoke-Scenario $scenario } "receipt hash mismatch"
Assert-Equal $scenario.State.BuildCalls 0 "Invalid finalized bytes must not be silently replaced with a rebuild"
Assert-Equal $scenario.State.UploadedApk "" "Invalid receipt cannot upload"

$scenario = New-Scenario
$scenario.Arguments.ReadFinalizedState = { return "false" }
Assert-Fails { Invoke-Scenario $scenario } "Boolean"
Assert-Equal $scenario.State.BuildCalls 0 "Invalid state cannot choose a destructive stage"

$revision = "a" * 40
function New-SourceFixture([object[]]$Responses) {
    $state = @{ Index = 0; Time = [datetime]::UtcNow; Sleeps = 0 }
    return @{
        State = $state
        Arguments = @{
            SourceRevision = $revision
            TimeoutSeconds = 40
            ReadStatus = {
                param($Revision)
                $response = $Responses[[math]::Min($state.Index, $Responses.Count - 1)]
                $state.Index++
                return $response
            }.GetNewClosure()
            Sleep = { param($Seconds) $state.Sleeps++; $state.Time = $state.Time.AddSeconds($Seconds) }.GetNewClosure()
            Now = { $state.Time }.GetNewClosure()
        }
    }
}
$success = [pscustomobject]@{ headSha = $revision; status = "completed"; conclusion = "success"; url = "https://example.test/ci" }
$pending = [pscustomobject]@{ headSha = $revision; status = "in_progress"; conclusion = ""; url = $success.url }
$fixture = New-SourceFixture @($pending, $success)
$arguments = $fixture.Arguments
Wait-CaatuuReleaseSourceCI @arguments 6>$null
Assert-Equal $fixture.State.Sleeps 1 "Pending source checks wait and reuse their existing run"
foreach ($conclusion in @("failure", "cancelled", "timed_out", "skipped")) {
    $fixture = New-SourceFixture @([pscustomobject]@{ headSha = $revision; status = "completed"; conclusion = $conclusion; url = $success.url })
    $arguments = $fixture.Arguments
    Assert-Fails { Wait-CaatuuReleaseSourceCI @arguments 6>$null } "Source CI failed"
    Assert-Equal $fixture.State.Sleeps 0 "Completed unsuccessful checks do not wait or retry a build"
}
$fixture = New-SourceFixture @([pscustomobject]@{ headSha = "b" * 40; status = "completed"; conclusion = "success"; url = $success.url })
$arguments = $fixture.Arguments
Assert-Fails { Wait-CaatuuReleaseSourceCI @arguments 6>$null } "revision does not match"
$fixture = New-SourceFixture @($pending)
$fixture.Arguments.ReadStatus = { return $null }
$arguments = $fixture.Arguments
Assert-Fails { Wait-CaatuuReleaseSourceCI @arguments 6>$null } "did not pass within"
Assert-Equal $fixture.State.Sleeps 2 "Missing source checks have a bounded wait"

Write-Output "PASS: release orchestration and source CI gate (pending, success, failure, cancellation, mismatched revision, bounded wait, receipt-only resume). No build, Git, network or publication commands executed."
