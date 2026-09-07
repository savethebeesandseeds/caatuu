Set-StrictMode -Version Latest

# The entrypoint supplies real guarded operations. Tests supply in-memory stages;
# there is no CLI/environment switch that bypasses publication safety checks.
function Invoke-CaatuuReleasePipeline {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateRange(1, [int]::MaxValue)][int]$VersionCode,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$CandidateReceipt,
        [Parameter(Mandatory)][scriptblock]$ReadFinalizedState,
        [Parameter(Mandatory)][scriptblock]$BuildStage,
        [Parameter(Mandatory)][scriptblock]$DeployStage
    )

    $complete = & $ReadFinalizedState
    if ($complete -isnot [bool]) { throw "Release state must report exactly one Boolean." }
    if ($complete) {
        Write-Host "Found finalized Android $VersionCode receipt; skipping the build stage."
    } else {
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

Export-ModuleMember -Function Invoke-CaatuuReleasePipeline
