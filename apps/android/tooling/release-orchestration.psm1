Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot "release-network-retry.psm1") -Force

function Wait-CaatuuReleaseSourceCI {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceRevision,
        [ValidateRange(1, 1800)][int]$TimeoutSeconds = 900,
        [scriptblock]$ReadStatus = {
            param($Revision)
            $result = Invoke-CaatuuNetworkRead -File "gh" -Label "Release source CI status" -Arguments @(
                "run", "list", "--repo", "savethebeesandseeds/caatuu",
                "--workflow", "repository-ci.yml", "--branch", "main", "--commit", $Revision,
                "--limit", "1", "--json", "headSha,status,conclusion,url"
            )
            if ($result.Code -ne 0) { throw "Source CI lookup failed: $($result.Output)" }
            $runs = @($result.Output | ConvertFrom-Json -ErrorAction Stop)
            if ($runs.Count -eq 0) { return $null }
            if ($runs.Count -ne 1) { throw "Source CI lookup must return at most one run." }
            return $runs[0]
        },
        [scriptblock]$Sleep = { param($Seconds) Start-Sleep -Seconds $Seconds },
        [scriptblock]$Now = { [datetime]::UtcNow }
    )
    $deadline = (& $Now).AddSeconds($TimeoutSeconds)
    $previousStatus = ""
    while ((& $Now) -lt $deadline) {
        $run = & $ReadStatus $SourceRevision
        if ($null -eq $run) {
            $status = "not yet scheduled"
        } else {
            if ($run.headSha -cne $SourceRevision) { throw "Source CI revision does not match the APK source." }
            $status = [string]$run.status
            if ($status -eq "completed") {
                if ($run.conclusion -ne "success") {
                    throw "Source CI failed ($($run.conclusion)): $($run.url). No APK build was started."
                }
                Write-Host "Source CI passed for $SourceRevision`: $($run.url)"
                return
            }
            if ($status -notin @("queued", "in_progress", "waiting", "pending", "requested")) {
                throw "Unrecognized source CI status: $status."
            }
        }
        if ($status -ne $previousStatus) {
            Write-Host "Source CI is $status; waiting before the APK build."
            $previousStatus = $status
        }
        $remaining = ($deadline - (& $Now)).TotalSeconds
        if ($remaining -gt 0) { & $Sleep ([int][math]::Min(20, [math]::Ceiling($remaining))) }
    }
    throw "Source CI did not pass within ${TimeoutSeconds}s. No APK build was started; retry the same version after checks finish."
}

# The entrypoint supplies real guarded operations. Tests supply in-memory stages;
# there is no CLI/environment switch that bypasses publication safety checks.
function Invoke-CaatuuReleasePipeline {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateRange(1, [int]::MaxValue)][int]$VersionCode,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$CandidateReceipt,
        [Parameter(Mandatory)][scriptblock]$ReadFinalizedState,
        [Parameter(Mandatory)][scriptblock]$SourceCheckStage,
        [Parameter(Mandatory)][scriptblock]$BuildStage,
        [Parameter(Mandatory)][scriptblock]$DeployStage
    )

    $complete = & $ReadFinalizedState
    if ($complete -isnot [bool]) { throw "Release state must report exactly one Boolean." }
    if ($complete) {
        Write-Host "Found finalized Android $VersionCode receipt; skipping the build stage."
    } else {
        & $SourceCheckStage
        Write-Host "Android $VersionCode is not completely finalized; running the guarded build-once stage."
        & $BuildStage
    }

    $complete = & $ReadFinalizedState
    if ($complete -isnot [bool] -or -not $complete) {
        throw "Android $VersionCode finished without its complete version-owned APK, manifest, and receipt."
    }
    # Existence selects the stage; only the receipt-only deployer authenticates
    # the files. A tampered candidate must fail there, never trigger a rebuild.
    Write-Host "Deploying only the exact bytes named by the finalized Android $VersionCode receipt."
    & $DeployStage $CandidateReceipt
}

Export-ModuleMember -Function Invoke-CaatuuReleasePipeline, Wait-CaatuuReleaseSourceCI
