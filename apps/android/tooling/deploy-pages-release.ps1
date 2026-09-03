[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$CandidateReceipt,

    [switch]$PlanOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedRepositoryRoot = [System.IO.Path]::GetFullPath("C:\Work\caatuu")
$ExpectedOrigin = "https://github.com/savethebeesandseeds/caatuu.git"
$Repository = "savethebeesandseeds/caatuu"
$DescriptorRelativePath = "apps/android/tooling/pages-current-release.json"
$DescriptorContainerPath = "/workspace/apps/android/tooling/pages-current-release.json"
$PagesMetadataCli = "apps/android/tooling/pages-current-release.mjs"
$PublicVerifier = "apps/android/tooling/verify-public-pages-release.mjs"
$Workflow = "pages.yml"
$TotalTimer = [System.Diagnostics.Stopwatch]::StartNew()
$DeployMutex = $null
$MutexOwned = $false
$TemporaryDirectory = $null

function Format-Seconds {
    param([System.Diagnostics.Stopwatch]$Timer)
    return [Math]::Round($Timer.Elapsed.TotalSeconds, 1).ToString("0.0", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-DeploymentTemporaryDirectory {
    if ($null -eq $script:TemporaryDirectory) {
        $script:TemporaryDirectory = Join-Path $ExpectedRepositoryRoot ("artifacts/android/.deploy-pages-" + [Guid]::NewGuid().ToString("N"))
        [void](New-Item -ItemType Directory -Path $script:TemporaryDirectory)
    }
    return $script:TemporaryDirectory
}

function Invoke-Phase {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "==> $Name"
    try {
        $result = & $Action
        Write-Host "<== $Name completed in $(Format-Seconds $timer)s"
        return $result
    }
    catch {
        Write-Host "<== $Name failed after $(Format-Seconds $timer)s"
        throw
    }
}

function Invoke-NativeResult {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [string[]]$Arguments = @()
    )
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = @(& $File @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    return [pscustomobject]@{
        Code = $code
        Output = ($lines -join [Environment]::NewLine)
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [string[]]$Arguments = @(),
        [string]$Label = $File
    )
    $result = Invoke-NativeResult -File $File -Arguments $Arguments
    if ($result.Code -ne 0) {
        throw "$Label failed with exit code $($result.Code).`n$($result.Output)"
    }
    return $result.Output
}

function ConvertFrom-CheckedJson {
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [Parameter(Mandatory = $true)][string]$Label
    )
    try {
        return $Json | ConvertFrom-Json
    }
    catch {
        throw "$Label did not return valid JSON."
    }
}

function Test-SamePath {
    param([string]$Left, [string]$Right)
    return [string]::Equals(
        [System.IO.Path]::GetFullPath($Left).TrimEnd('\'),
        [System.IO.Path]::GetFullPath($Right).TrimEnd('\'),
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Assert-RegularFile {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing: $Path"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label must not be a symbolic link or reparse point: $Path"
    }
    return $item
}

function Get-GitOutput {
    param([string[]]$Arguments, [string]$Label = "git")
    return Invoke-Checked -File "git" -Arguments (@("-C", $ExpectedRepositoryRoot) + $Arguments) -Label $Label
}

function Get-NonEmptyLines {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
    return @($Value -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Assert-OnePath {
    param([string[]]$Paths, [string]$Expected, [string]$Label)
    if ($Paths.Count -ne 1 -or $Paths[0] -ne $Expected) {
        throw "$Label must contain only $Expected; found: $($Paths -join ', ')"
    }
}

function Assert-MainOnlyInvariant {
    param([switch]$CheckRemote)
    if ((Get-GitOutput @("symbolic-ref", "--short", "HEAD") "branch check").Trim() -ne "main") {
        throw "Android publication must run on main."
    }
    $localHeads = @(Get-NonEmptyLines (Get-GitOutput @("for-each-ref", "--format=%(refname)", "refs/heads") "local branch inventory"))
    Assert-OnePath $localHeads "refs/heads/main" "Local branches"
    $remoteRefs = @(Get-NonEmptyLines (Get-GitOutput @("for-each-ref", "--format=%(refname)", "refs/remotes") "remote-tracking inventory") |
        Where-Object { $_ -notmatch '/HEAD$' })
    Assert-OnePath $remoteRefs "refs/remotes/origin/main" "Remote-tracking branches"
    $worktreeLines = @(Get-NonEmptyLines (Get-GitOutput @("worktree", "list", "--porcelain") "worktree inventory") |
        Where-Object { $_ -like "worktree *" })
    if ($worktreeLines.Count -ne 1) { throw "Exactly one Caatuu worktree is required." }
    if (-not (Test-SamePath $worktreeLines[0].Substring(9) $ExpectedRepositoryRoot)) {
        throw "The sole worktree is not the canonical Caatuu checkout."
    }
    if ((Get-GitOutput @("remote", "get-url", "origin") "origin check").Trim() -ne $ExpectedOrigin) {
        throw "origin must be exactly $ExpectedOrigin"
    }
    if ($CheckRemote) {
        $remoteHeads = @(Get-NonEmptyLines (Get-GitOutput @("ls-remote", "--heads", "origin") "remote branch inventory"))
        if ($remoteHeads.Count -ne 1 -or $remoteHeads[0] -notmatch '\srefs/heads/main$') {
            throw "The GitHub repository must expose only refs/heads/main."
        }
    }
}

function Get-WorktreeState {
    $statusLines = @(Get-NonEmptyLines (Get-GitOutput @("status", "--porcelain=v1", "--untracked-files=all") "git status"))
    $counts = (Get-GitOutput @("rev-list", "--left-right", "--count", "refs/remotes/origin/main...HEAD") "git divergence check").Trim() -split "\s+"
    if ($counts.Count -ne 2) { throw "Could not read main's remote divergence." }
    $behind = [int]$counts[0]
    $ahead = [int]$counts[1]

    if ($statusLines.Count -eq 0 -and $behind -eq 0 -and $ahead -eq 0) {
        return [pscustomobject]@{ Kind = "clean"; Ahead = 0; Behind = 0 }
    }
    if ($statusLines.Count -eq 1 -and $behind -eq 0 -and $ahead -eq 0) {
        if ($statusLines[0] -notmatch '^.. apps/android/tooling/pages-current-release\.json$') {
            throw "The worktree contains an unrelated change: $($statusLines[0])"
        }
        return [pscustomobject]@{ Kind = "pending-descriptor"; Ahead = 0; Behind = 0 }
    }
    if ($statusLines.Count -eq 0 -and $behind -eq 0 -and $ahead -eq 1) {
        $changed = @(Get-NonEmptyLines (Get-GitOutput @("diff", "--name-only", "refs/remotes/origin/main..HEAD") "pending commit inspection"))
        Assert-OnePath $changed $DescriptorRelativePath "The one pending deployment commit"
        return [pscustomobject]@{ Kind = "pending-commit"; Ahead = 1; Behind = 0 }
    }
    throw "Deployment requires a clean tree, one exact pending descriptor edit, or one descriptor-only commit ahead of origin/main. Found $($statusLines.Count) dirty path(s), ahead=$ahead, behind=$behind."
}

function Convert-ToContainerPath {
    param([string]$HostPath)
    $root = $ExpectedRepositoryRoot.TrimEnd('\')
    $full = [System.IO.Path]::GetFullPath($HostPath)
    $prefix = "$root\"
    if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes the canonical repository: $full"
    }
    return "/workspace/" + $full.Substring($prefix.Length).Replace('\', '/')
}

function Invoke-PagesAdvance {
    param([string]$DescriptorPath, [switch]$Write)
    $arguments = @(
        "exec", "--workdir", "/workspace", "caatuu-dev", "node", $PagesMetadataCli, "advance",
        "--descriptor", (Convert-ToContainerPath $DescriptorPath),
        "--manifest", (Convert-ToContainerPath $script:ManifestPath),
        "--apk", (Convert-ToContainerPath $script:ApkPath),
        "--receipt", (Convert-ToContainerPath $script:ReceiptPath)
    )
    if ($Write) { $arguments += "--write" }
    $output = Invoke-Checked -File "docker" -Arguments $arguments -Label "Pages release descriptor validation"
    return ConvertFrom-CheckedJson $output "Pages release descriptor validation"
}

function Write-GitBlob {
    param([string]$Revision, [string]$RepositoryPath, [string]$Destination)
    $content = Get-GitOutput @("show", "${Revision}:$RepositoryPath") "read $RepositoryPath from $Revision"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Destination, $content + "`n", $utf8)
}

function Assert-ExactDescriptorAdvance {
    param([string]$BaseRevision, [string]$ActualDescriptor)
    $reconstructionDirectory = Join-Path (Get-DeploymentTemporaryDirectory) ("descriptor-" + [Guid]::NewGuid().ToString("N"))
    [void](New-Item -ItemType Directory -Path $reconstructionDirectory)
    $reconstructed = Join-Path $reconstructionDirectory "pages-current-release.json"
    Write-GitBlob $BaseRevision $DescriptorRelativePath $reconstructed
    $result = Invoke-PagesAdvance -DescriptorPath $reconstructed -Write
    if ($result.action -notin @("append", "reuse")) { throw "Descriptor reconstruction returned an invalid action." }
    $expectedHash = (Get-FileHash -LiteralPath $reconstructed -Algorithm SHA256).Hash
    $actualHash = (Get-FileHash -LiteralPath $ActualDescriptor -Algorithm SHA256).Hash
    if ($expectedHash -ne $actualHash) {
        throw "The pending Pages descriptor is not the exact deterministic candidate advance."
    }
    return $result
}

function Assert-ReleaseTagTarget {
    param([string]$TagCommit, [string]$Tag)
    $tagKnown = Invoke-NativeResult -File "git" -Arguments @(
        "-C", $ExpectedRepositoryRoot, "cat-file", "-e", "$TagCommit^{commit}"
    )
    $tagOnMain = Invoke-NativeResult -File "git" -Arguments @(
        "-C", $ExpectedRepositoryRoot, "merge-base", "--is-ancestor", $TagCommit, "refs/remotes/origin/main"
    )
    if ($tagKnown.Code -ne 0 -or $tagOnMain.Code -ne 0) {
        throw "Release tag $Tag is not an immutable ancestor of origin/main."
    }

    $tagDirectory = Join-Path (Get-DeploymentTemporaryDirectory) ("tag-" + [Guid]::NewGuid().ToString("N"))
    [void](New-Item -ItemType Directory -Path $tagDirectory)
    $tagDescriptor = Join-Path $tagDirectory "pages-current-release.json"
    Write-GitBlob $TagCommit $DescriptorRelativePath $tagDescriptor
    $tagCandidate = Invoke-PagesAdvance -DescriptorPath $tagDescriptor
    if ($tagCandidate.action -ne "reuse" -or
        [int]$tagCandidate.versionCode -ne [int]$script:candidate.versionCode -or
        [string]$tagCandidate.tag -ne $Tag) {
        throw "Release tag $Tag does not contain the exact sealed Android candidate."
    }
}

function Assert-SourceOnOriginMain {
    param([string]$Revision)
    if ($Revision -notmatch '^[a-f0-9]{40}$') { throw "The candidate source revision is invalid." }
    [void](Get-GitOutput @("cat-file", "-e", "$Revision^{commit}") "candidate source lookup")
    $result = Invoke-NativeResult -File "git" -Arguments @("-C", $ExpectedRepositoryRoot, "merge-base", "--is-ancestor", $Revision, "refs/remotes/origin/main")
    if ($result.Code -ne 0) { throw "Candidate source $Revision is not on origin/main." }
}

function Assert-ExactCandidateSource {
    param([string]$ExpectedRevision, [string]$Context)
    $actualRevision = [string]$script:receipt.source_revision
    if ($actualRevision -ne $ExpectedRevision) {
        throw "$Context requires receipt source_revision $ExpectedRevision; found $actualRevision. Rebuild once from the exact pushed source instead of publishing a stale candidate."
    }
}

function Get-GitHubRelease {
    param([string]$Tag, [switch]$AllowMissing)
    $result = Invoke-NativeResult -File "gh" -Arguments @(
        "release", "view", $Tag, "--repo", $Repository,
        "--json", "tagName,isDraft,isPrerelease,assets"
    )
    if ($result.Code -eq 0) {
        $view = ConvertFrom-CheckedJson $result.Output "GitHub Release lookup"
        return [pscustomobject]@{
            tag_name   = [string]$view.tagName
            draft      = [bool]$view.isDraft
            prerelease = [bool]$view.isPrerelease
            assets     = @($view.assets)
        }
    }
    if ($AllowMissing -and $result.Output -match '(?i)(HTTP\s+404|not found)') { return $null }
    throw "GitHub Release lookup failed with exit code $($result.Code).`n$($result.Output)"
}

function Assert-ReleaseIdentity {
    param($Release, [string]$Tag)
    if ($Release.tag_name -ne $Tag) { throw "GitHub returned the wrong release tag." }
    if ([bool]$Release.prerelease) { throw "The stable Android release must not be a prerelease." }
}

function Assert-ServerAssets {
    param($Release, [object[]]$ExpectedAssets, [switch]$AllowMissing)
    $expectedByName = @{}
    foreach ($asset in $ExpectedAssets) { $expectedByName[[string]$asset.releaseAssetName] = $asset }
    $seen = @{}
    foreach ($remote in @($Release.assets)) {
        $name = [string]$remote.name
        if (-not $expectedByName.ContainsKey($name)) { throw "GitHub Release contains an unexpected asset: $name" }
        if ($seen.ContainsKey($name)) { throw "GitHub Release repeats asset: $name" }
        $expected = $expectedByName[$name]
        if ([int64]$remote.size -ne [int64]$expected.bytes) { throw "GitHub asset $name has the wrong byte count." }
        if ([string]$remote.digest -ne "sha256:$($expected.sha256)") { throw "GitHub asset $name has the wrong or missing server digest." }
        $seen[$name] = $true
    }
    if (-not $AllowMissing) {
        foreach ($name in $expectedByName.Keys) {
            if (-not $seen.ContainsKey($name)) { throw "GitHub Release is missing asset: $name" }
        }
        if ($seen.Count -ne $expectedByName.Count) { throw "GitHub Release asset set changed." }
    }
    return $seen
}

function Get-WorkflowRuns {
    $json = Invoke-Checked -File "gh" -Arguments @(
        "run", "list", "--repo", $Repository, "--workflow", $Workflow, "--branch", "main",
        "--event", "workflow_dispatch", "--limit", "50",
        "--json", "databaseId,headSha,status,conclusion,createdAt,url,event"
    ) -Label "Pages workflow run lookup"
    if ([string]::IsNullOrWhiteSpace($json)) { return @() }
    return @($json | ConvertFrom-Json)
}

function Wait-PagesRun {
    param([string]$Head)
    $runs = @(Get-WorkflowRuns | Where-Object { $_.headSha -eq $Head } | Sort-Object createdAt -Descending)
    $successful = @($runs | Where-Object { $_.status -eq "completed" -and $_.conclusion -eq "success" } | Select-Object -First 1)
    if ($successful.Count -eq 1) { return $successful[0] }
    $active = @($runs | Where-Object { $_.status -ne "completed" } | Select-Object -First 1)
    if ($active.Count -eq 0) {
        $knownIds = @{}
        foreach ($run in $runs) { $knownIds[[string]$run.databaseId] = $true }
        Assert-MainOnlyInvariant -CheckRemote
        if ((Get-WorktreeState).Kind -ne "clean") { throw "The repository changed before Pages dispatch." }
        $dispatchHead = (Get-GitOutput @("rev-parse", "HEAD") "Pages dispatch HEAD").Trim()
        if ($dispatchHead -ne $Head) { throw "HEAD changed before Pages dispatch." }
        $githubMain = (Invoke-Checked -File "gh" -Arguments @("api", "repos/$Repository/commits/main", "--jq", ".sha") -Label "GitHub main before Pages dispatch").Trim()
        if ($githubMain -ne $Head) { throw "GitHub main changed before Pages dispatch." }
        [void](Invoke-Checked -File "gh" -Arguments @(
            "workflow", "run", $Workflow, "--repo", $Repository, "--ref", "main",
            "-f", "allow_http_certificate_bootstrap=false",
            "-f", "expected_revision=$Head"
        ) -Label "Pages workflow dispatch")
        for ($attempt = 1; $attempt -le 30; $attempt += 1) {
            Start-Sleep -Seconds 2
            $newRuns = @(Get-WorkflowRuns | Where-Object {
                $_.headSha -eq $Head -and -not $knownIds.ContainsKey([string]$_.databaseId)
            } | Sort-Object createdAt -Descending)
            if ($newRuns.Count -gt 0) { $active = @($newRuns[0]); break }
        }
        if ($active.Count -eq 0) { throw "The dispatched Pages workflow did not appear for HEAD $Head." }
    }

    $runId = [string]$active[0].databaseId
    [void](Invoke-Checked -File "gh" -Arguments @(
        "run", "watch", $runId, "--repo", $Repository, "--exit-status", "--interval", "10"
    ) -Label "Pages workflow $runId")
    $viewJson = Invoke-Checked -File "gh" -Arguments @(
        "run", "view", $runId, "--repo", $Repository,
        "--json", "databaseId,headSha,status,conclusion,url,event"
    ) -Label "Pages workflow result"
    $completed = ConvertFrom-CheckedJson $viewJson "Pages workflow result"
    if ($completed.headSha -ne $Head -or $completed.event -ne "workflow_dispatch" -or
        $completed.status -ne "completed" -or $completed.conclusion -ne "success") {
        throw "Pages workflow $runId did not complete successfully for exact HEAD $Head."
    }
    return $completed
}

try {
    $scriptRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
    if (-not (Test-SamePath $scriptRoot $ExpectedRepositoryRoot)) {
        throw "Run the deployer only from the canonical Caatuu checkout at $ExpectedRepositoryRoot."
    }
    $gitDirectory = Join-Path $ExpectedRepositoryRoot ".git"
    if (-not (Test-Path -LiteralPath $gitDirectory -PathType Container)) { throw "The canonical Git directory is missing." }
    try {
        $DeployMutex = New-Object System.Threading.Mutex($false, "Local\CaatuuPagesReleaseDeployment")
        $MutexOwned = $DeployMutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] { $MutexOwned = $true }
    catch {
        throw "Could not acquire the Caatuu Pages deployment mutex."
    }
    if (-not $MutexOwned) { throw "Another Caatuu Pages deployment owns the fail-fast release mutex." }

    $script:state = $null
    $script:candidate = $null
    $script:receipt = $null
    Invoke-Phase "Preflight and sealed receipt validation" {
        foreach ($command in @("git", "docker", "gh")) {
            if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
        }
        $topLevel = (Get-GitOutput @("rev-parse", "--show-toplevel") "canonical repository lookup").Trim()
        if (-not (Test-SamePath $topLevel $ExpectedRepositoryRoot)) { throw "Git resolved a noncanonical checkout: $topLevel" }
        Assert-MainOnlyInvariant

        [void](Invoke-Checked -File "gh" -Arguments @("auth", "status", "--hostname", "github.com") -Label "GitHub CLI authentication")
        $owner = (Invoke-Checked -File "gh" -Arguments @("repo", "view", $Repository, "--json", "nameWithOwner", "--jq", ".nameWithOwner") -Label "GitHub repository identity").Trim()
        if ($owner -ne $Repository) { throw "GitHub CLI resolved the wrong repository: $owner" }

        [void](Get-GitOutput @("fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main") "origin/main fetch")
        Assert-MainOnlyInvariant -CheckRemote

        $inspectJson = Invoke-Checked -File "docker" -Arguments @("inspect", "caatuu-dev") -Label "caatuu-dev inspection"
        $containers = @(ConvertFrom-CheckedJson $inspectJson "caatuu-dev inspection")
        if ($containers.Count -ne 1 -or $containers[0].Name -ne "/caatuu-dev" -or -not [bool]$containers[0].State.Running) {
            throw "The canonical caatuu-dev container is not running."
        }
        $workspaceMounts = @($containers[0].Mounts | Where-Object { $_.Destination -eq "/workspace" })
        if ($workspaceMounts.Count -ne 1 -or $workspaceMounts[0].Type -ne "bind" -or -not [bool]$workspaceMounts[0].RW -or
            -not (Test-SamePath ([string]$workspaceMounts[0].Source) $ExpectedRepositoryRoot)) {
            throw "caatuu-dev must bind the canonical checkout read-write at /workspace."
        }
        if ([string]$containers[0].Config.WorkingDir -ne "/workspace") {
            throw "caatuu-dev has the wrong working directory."
        }

        $candidateFullPath = if ([System.IO.Path]::IsPathRooted($CandidateReceipt)) {
            [System.IO.Path]::GetFullPath($CandidateReceipt)
        } else {
            [System.IO.Path]::GetFullPath((Join-Path $ExpectedRepositoryRoot $CandidateReceipt))
        }
        $rootPrefix = $ExpectedRepositoryRoot.TrimEnd('\') + "\"
        if (-not $candidateFullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Candidate receipt must be inside the canonical repository."
        }
        [void](Assert-RegularFile $candidateFullPath "Candidate receipt")
        $relativeReceipt = $candidateFullPath.Substring($rootPrefix.Length).Replace('\', '/')
        $match = [regex]::Match($relativeReceipt, '^artifacts/android/releases/([1-9][0-9]*)/caatuu-release-candidate\.json$')
        if (-not $match.Success) {
            throw "-CandidateReceipt must name a finalized version-owned receipt under artifacts/android/releases/<versionCode>/."
        }
        $script:ReceiptPath = $candidateFullPath
        $releaseDirectory = Split-Path -Parent $candidateFullPath
        $script:ManifestPath = [System.IO.Path]::GetFullPath((Join-Path $releaseDirectory "caatuu.json"))
        $script:ApkPath = [System.IO.Path]::GetFullPath((Join-Path $releaseDirectory "caatuu.apk"))
        [void](Assert-RegularFile $script:ManifestPath "Finalized release manifest")
        [void](Assert-RegularFile $script:ApkPath "Finalized release APK")

        $script:receipt = Get-Content -LiteralPath $script:ReceiptPath -Raw | ConvertFrom-Json
        if ([string]$script:receipt.schema_name -ne "caatuu-android-release-candidate" -or [int]$script:receipt.schema_version -ne 1) {
            throw "Candidate receipt schema changed."
        }
        if ([int]$script:receipt.identity.version_code -ne [int]$match.Groups[1].Value) {
            throw "Candidate receipt version does not match its finalized directory."
        }
        Assert-SourceOnOriginMain ([string]$script:receipt.source_revision)
        $script:candidate = Invoke-PagesAdvance -DescriptorPath (Join-Path $ExpectedRepositoryRoot $DescriptorRelativePath)
        if ([int]$script:candidate.versionCode -ne [int]$script:receipt.identity.version_code) {
            throw "Validated Pages candidate version differs from its receipt."
        }
        $expectedKinds = @("apk", "manifest", "receipt")
        $actualKinds = @($script:candidate.assets | ForEach-Object { [string]$_.kind } | Sort-Object)
        if (($actualKinds -join ',') -ne (($expectedKinds | Sort-Object) -join ',')) {
            throw "The release must contain exactly APK, manifest, and receipt assets."
        }

        $script:state = Get-WorktreeState
        $descriptorPath = Join-Path $ExpectedRepositoryRoot $DescriptorRelativePath
        if ($script:state.Kind -eq "clean" -and $script:candidate.action -eq "append") {
            $sourceHead = (Get-GitOutput @("rev-parse", "HEAD") "candidate source HEAD").Trim()
            Assert-ExactCandidateSource $sourceHead "A new Pages descriptor advance"
        }
        if ($script:state.Kind -eq "pending-descriptor") {
            $reconstruction = Assert-ExactDescriptorAdvance "HEAD" $descriptorPath
            if ($script:candidate.action -ne "reuse") { throw "The pending descriptor does not contain this candidate." }
            if ($reconstruction.action -eq "append") {
                $sourceHead = (Get-GitOutput @("rev-parse", "HEAD") "candidate source HEAD").Trim()
                Assert-ExactCandidateSource $sourceHead "A pending new Pages descriptor advance"
            }
        }
        if ($script:state.Kind -eq "pending-commit") {
            $reconstruction = Assert-ExactDescriptorAdvance "refs/remotes/origin/main" $descriptorPath
            $subject = (Get-GitOutput @("log", "-1", "--format=%s", "HEAD") "pending commit subject").Trim()
            if ($subject -ne "Publish Android $($script:candidate.versionCode) to GitHub Pages") {
                throw "The one pending commit is not the expected deployment commit."
            }
            if ($script:candidate.action -ne "reuse") { throw "The pending deployment commit does not contain this candidate." }
            $parents = (Get-GitOutput @("rev-list", "--parents", "-n", "1", "HEAD") "pending deployment parent").Trim() -split "\s+"
            if ($parents.Count -ne 2) { throw "The pending deployment commit must have exactly one parent." }
            Assert-ExactCandidateSource $parents[1] "The pending descriptor-only deployment commit"
        }
    }

    if ($PlanOnly) {
        # Plan mode may refresh origin/main and use an ignored temporary
        # reconstruction, which is removed in finally. It never changes the
        # tracked descriptor, creates a commit/release, or deploys Pages.
        [pscustomobject]@{
            mode = "plan-only"
            candidate = [int]$script:candidate.versionCode
            versionName = [string]$script:candidate.versionName
            tag = [string]$script:candidate.tag
            descriptorAction = [string]$script:candidate.action
            repositoryState = [string]$script:state.Kind
            willBuild = $false
        } | ConvertTo-Json -Compress
        return
    }

    $script:head = $null
    Invoke-Phase "Commit and push the descriptor handoff" {
        Assert-MainOnlyInvariant -CheckRemote
        $descriptorPath = Join-Path $ExpectedRepositoryRoot $DescriptorRelativePath
        if ($script:state.Kind -eq "clean" -and $script:candidate.action -eq "append") {
            $written = Invoke-PagesAdvance -DescriptorPath $descriptorPath -Write
            if (-not [bool]$written.wrote -or $written.action -ne "append") {
                throw "The descriptor advance was not written."
            }
            [void](Assert-ExactDescriptorAdvance "HEAD" $descriptorPath)
            $script:state = Get-WorktreeState
            if ($script:state.Kind -ne "pending-descriptor") { throw "Descriptor write changed an unexpected repository path." }
        }
        if ($script:state.Kind -eq "pending-descriptor") {
            Assert-MainOnlyInvariant -CheckRemote
            if ((Get-WorktreeState).Kind -ne "pending-descriptor") {
                throw "The repository changed before staging the Pages descriptor."
            }
            [void](Get-GitOutput @("add", "--", $DescriptorRelativePath) "stage Pages descriptor")
            $staged = @(Get-NonEmptyLines (Get-GitOutput @("diff", "--cached", "--name-only") "staged path inspection"))
            Assert-OnePath $staged $DescriptorRelativePath "Staged deployment paths"
            Assert-MainOnlyInvariant -CheckRemote
            if ((Get-WorktreeState).Kind -ne "pending-descriptor") {
                throw "The repository changed before committing the Pages descriptor."
            }
            [void](Get-GitOutput @(
                "commit", "--only", "-m", "Publish Android $($script:candidate.versionCode) to GitHub Pages", "--", $DescriptorRelativePath
            ) "Pages descriptor commit")
            $script:state = Get-WorktreeState
        }
        if ($script:state.Kind -eq "pending-commit") {
            Assert-MainOnlyInvariant -CheckRemote
            if ((Get-WorktreeState).Kind -ne "pending-commit") {
                throw "The repository changed before pushing the Pages descriptor."
            }
            [void](Get-GitOutput @("push", "origin", "HEAD:refs/heads/main") "push main")
            [void](Get-GitOutput @("fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main") "confirm origin/main")
            $script:state = Get-WorktreeState
        }
        if ($script:state.Kind -ne "clean") { throw "The descriptor handoff did not finish in a clean, synchronized state." }
        $script:head = (Get-GitOutput @("rev-parse", "HEAD") "deployment HEAD").Trim()
        $originHead = (Get-GitOutput @("rev-parse", "refs/remotes/origin/main") "origin/main HEAD").Trim()
        if ($script:head -ne $originHead) { throw "The deployment commit is not synchronized with origin/main." }
        $script:candidate = Invoke-PagesAdvance -DescriptorPath $descriptorPath
        if ($script:candidate.action -ne "reuse") { throw "The pushed descriptor does not contain the sealed candidate." }
    }

    $script:release = $null
    Invoke-Phase "Create or resume the immutable GitHub Release" {
        Assert-MainOnlyInvariant -CheckRemote
        if ((Get-WorktreeState).Kind -ne "clean") { throw "The repository changed after its descriptor handoff." }
        $githubMain = (Invoke-Checked -File "gh" -Arguments @("api", "repos/$Repository/commits/main", "--jq", ".sha") -Label "GitHub main before release").Trim()
        if ($githubMain -ne $script:head) { throw "GitHub main changed before GitHub Release publication." }
        $tag = [string]$script:candidate.tag
        $remoteTagLines = @(Get-NonEmptyLines (Get-GitOutput @("ls-remote", "--tags", "origin", "refs/tags/$tag", "refs/tags/$tag^{}") "release tag lookup"))
        if ($remoteTagLines.Count -eq 0) {
            Assert-MainOnlyInvariant -CheckRemote
            if ((Get-WorktreeState).Kind -ne "clean") { throw "The repository changed before release tag publication." }
            $tagHead = (Get-GitOutput @("rev-parse", "HEAD") "release tag HEAD").Trim()
            if ($tagHead -ne $script:head) { throw "HEAD changed before release tag publication." }
            $githubMain = (Invoke-Checked -File "gh" -Arguments @("api", "repos/$Repository/commits/main", "--jq", ".sha") -Label "GitHub main before release tag publication").Trim()
            if ($githubMain -ne $script:head) { throw "GitHub main changed before release tag publication." }
            $pushTag = Invoke-NativeResult -File "git" -Arguments @("-C", $ExpectedRepositoryRoot, "push", "origin", "$($script:head):refs/tags/$tag")
            if ($pushTag.Code -ne 0) {
                $remoteTagLines = @(Get-NonEmptyLines (Get-GitOutput @("ls-remote", "--tags", "origin", "refs/tags/$tag", "refs/tags/$tag^{}") "release tag race check"))
                if ($remoteTagLines.Count -eq 0) { throw "Release tag creation failed.`n$($pushTag.Output)" }
            }
        }

        $tagCommit = (Invoke-Checked -File "gh" -Arguments @("api", "repos/$Repository/commits/$tag", "--jq", ".sha") -Label "release tag target").Trim()
        if ($tagCommit -notmatch '^[a-f0-9]{40}$') { throw "GitHub returned an invalid release tag target." }
        Assert-ReleaseTagTarget $tagCommit $tag
        $script:release = Get-GitHubRelease -Tag $tag -AllowMissing
        if ($null -eq $script:release) {
            Assert-MainOnlyInvariant -CheckRemote
            if ((Get-WorktreeState).Kind -ne "clean") { throw "The repository changed before draft release creation." }
            $currentHead = (Get-GitOutput @("rev-parse", "HEAD") "HEAD before draft release creation").Trim()
            if ($currentHead -ne $script:head) { throw "HEAD changed before draft release creation." }
            $githubMain = (Invoke-Checked -File "gh" -Arguments @("api", "repos/$Repository/commits/main", "--jq", ".sha") -Label "GitHub main before draft release creation").Trim()
            if ($githubMain -ne $script:head) { throw "GitHub main changed before draft release creation." }
            $create = Invoke-NativeResult -File "gh" -Arguments @(
                "release", "create", $tag, "--repo", $Repository, "--verify-tag", "--draft", "--latest=false",
                "--title", "Caatuu Android $($script:candidate.versionName) (versionCode $($script:candidate.versionCode))",
                "--notes", "Signed Caatuu Android release $($script:candidate.versionName), versionCode $($script:candidate.versionCode)."
            )
            if ($create.Code -ne 0) {
                $script:release = Get-GitHubRelease -Tag $tag -AllowMissing
                if ($null -eq $script:release) { throw "Draft GitHub Release creation failed.`n$($create.Output)" }
            } else {
                $script:release = Get-GitHubRelease -Tag $tag
            }
        }
        Assert-ReleaseIdentity $script:release $tag

        $expectedAssets = @($script:candidate.assets)
        $assetDirectory = Get-DeploymentTemporaryDirectory
        $versionCode = [int]$script:candidate.versionCode
        $expectedNames = @(
            "caatuu-$versionCode.apk",
            "caatuu-$versionCode.json",
            "caatuu-$versionCode-release-candidate.json"
        ) | Sort-Object
        $actualNames = @($expectedAssets | ForEach-Object { [string]$_.releaseAssetName } | Sort-Object)
        if (($actualNames -join ',') -ne ($expectedNames -join ',')) { throw "Derived GitHub release asset names changed." }

        foreach ($asset in $expectedAssets) {
            $source = Join-Path $ExpectedRepositoryRoot ([string]$asset.sourcePath).Replace('/', '\')
            $sourceItem = Assert-RegularFile $source "Finalized $($asset.kind)"
            if ([int64]$sourceItem.Length -ne [int64]$asset.bytes) { throw "Finalized $($asset.kind) byte count changed." }
            if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$asset.sha256) {
                throw "Finalized $($asset.kind) SHA-256 changed."
            }
            $copy = Join-Path $assetDirectory ([string]$asset.releaseAssetName)
            Copy-Item -LiteralPath $source -Destination $copy
            $copyItem = Assert-RegularFile $copy "Temporary $($asset.kind) release asset"
            if ([int64]$copyItem.Length -ne [int64]$asset.bytes -or
                (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$asset.sha256) {
                throw "Temporary $($asset.kind) release asset differs from its sealed identity."
            }
        }

        if ([bool]$script:release.draft) {
            $present = Assert-ServerAssets $script:release $expectedAssets -AllowMissing
            foreach ($asset in $expectedAssets) {
                $name = [string]$asset.releaseAssetName
                if ($present.ContainsKey($name)) { continue }
                $uploadPath = Join-Path $assetDirectory $name
                Assert-MainOnlyInvariant -CheckRemote
                if ((Get-WorktreeState).Kind -ne "clean") { throw "The repository changed before uploading $name." }
                $currentHead = (Get-GitOutput @("rev-parse", "HEAD") "HEAD before uploading $name").Trim()
                if ($currentHead -ne $script:head) { throw "HEAD changed before uploading $name." }
                $githubMain = (Invoke-Checked -File "gh" -Arguments @("api", "repos/$Repository/commits/main", "--jq", ".sha") -Label "GitHub main before uploading $name").Trim()
                if ($githubMain -ne $script:head) { throw "GitHub main changed before uploading $name." }
                $upload = Invoke-NativeResult -File "gh" -Arguments @("release", "upload", $tag, $uploadPath, "--repo", $Repository)
                if ($upload.Code -ne 0) {
                    $script:release = Get-GitHubRelease -Tag $tag
                    try {
                        $recovered = Assert-ServerAssets $script:release $expectedAssets -AllowMissing
                        if (-not $recovered.ContainsKey($name)) { throw "Asset is still missing." }
                    }
                    catch { throw "GitHub asset upload failed without an exact recoverable asset: $name`n$($upload.Output)" }
                }
            }
            $script:release = Get-GitHubRelease -Tag $tag
            [void](Assert-ServerAssets $script:release $expectedAssets)
            Assert-MainOnlyInvariant -CheckRemote
            if ((Get-WorktreeState).Kind -ne "clean") { throw "The repository changed before publishing the GitHub Release." }
            $currentHead = (Get-GitOutput @("rev-parse", "HEAD") "HEAD before publishing the GitHub Release").Trim()
            if ($currentHead -ne $script:head) { throw "HEAD changed before publishing the GitHub Release." }
            $githubMain = (Invoke-Checked -File "gh" -Arguments @("api", "repos/$Repository/commits/main", "--jq", ".sha") -Label "GitHub main before publishing the GitHub Release").Trim()
            if ($githubMain -ne $script:head) { throw "GitHub main changed before publishing the GitHub Release." }
            [void](Invoke-Checked -File "gh" -Arguments @(
                "release", "edit", $tag, "--repo", $Repository, "--draft=false", "--latest=false"
            ) -Label "publish GitHub Release")
            $script:release = Get-GitHubRelease -Tag $tag
        }
        Assert-ReleaseIdentity $script:release $tag
        if ([bool]$script:release.draft) { throw "GitHub Release remained a draft." }
        [void](Assert-ServerAssets $script:release $expectedAssets)
    }

    $script:pagesRun = $null
    Invoke-Phase "Deploy the exact main commit with GitHub Pages" {
        Assert-MainOnlyInvariant -CheckRemote
        if ((Get-WorktreeState).Kind -ne "clean") { throw "The repository changed during GitHub Release publication." }
        $currentHead = (Get-GitOutput @("rev-parse", "HEAD") "current HEAD").Trim()
        if ($currentHead -ne $script:head) { throw "HEAD changed during Android deployment." }
        $remoteHead = (Invoke-Checked -File "gh" -Arguments @("api", "repos/$Repository/commits/main", "--jq", ".sha") -Label "GitHub main HEAD").Trim()
        if ($remoteHead -ne $script:head) { throw "GitHub main changed before Pages dispatch." }
        $script:pagesRun = Wait-PagesRun $script:head
    }

    $script:publicResult = $null
    Invoke-Phase "Verify public Pages, Android, and reporting routes" {
        $verifyJson = Invoke-Checked -File "docker" -Arguments @(
            "exec", "--workdir", "/workspace", "caatuu-dev", "node", $PublicVerifier,
            "--descriptor", $DescriptorContainerPath
        ) -Label "public Pages verification"
        $script:publicResult = ConvertFrom-CheckedJson $verifyJson "public Pages verification"
        if (-not [bool]$script:publicResult.ok -or [int]$script:publicResult.versionCode -ne [int]$script:candidate.versionCode) {
            throw "Public verification returned the wrong Android release."
        }
    }

    [pscustomobject]@{
        deployed = $true
        versionCode = [int]$script:candidate.versionCode
        versionName = [string]$script:candidate.versionName
        tag = [string]$script:candidate.tag
        manifest = "https://caatuu.waajacu.com/android/caatuu.json"
        workflowRun = [string]$script:pagesRun.url
        reportingVersion = [string]$script:publicResult.reportingVersion
        built = $false
        totalSeconds = [Math]::Round($TotalTimer.Elapsed.TotalSeconds, 1)
    } | ConvertTo-Json -Compress
}
finally {
    if ($null -ne $DeployMutex) {
        if ($MutexOwned) { $DeployMutex.ReleaseMutex() }
        $DeployMutex.Dispose()
    }
    if ($null -ne $TemporaryDirectory -and (Test-Path -LiteralPath $TemporaryDirectory -PathType Container)) {
        $expectedTemporaryPrefix = Join-Path $ExpectedRepositoryRoot "artifacts\android\.deploy-pages-"
        if ($TemporaryDirectory.StartsWith($expectedTemporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force
        }
    }
    $TotalTimer.Stop()
    Write-Host "Android Pages deployment command finished in $(Format-Seconds $TotalTimer)s"
}
