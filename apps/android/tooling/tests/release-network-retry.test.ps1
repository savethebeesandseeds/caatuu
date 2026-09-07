[CmdletBinding()]
param([switch]$NestedInvocation)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "../release-network-retry.psm1") -Force

$script:Passed = 0
function Assert-Equal($Actual, $Expected, [string]$Label) {
    if (($Actual | ConvertTo-Json -Depth 10 -Compress) -cne ($Expected | ConvertTo-Json -Depth 10 -Compress)) {
        throw "$Label differs. Actual=$($Actual | ConvertTo-Json -Compress); expected=$($Expected | ConvertTo-Json -Compress)"
    }
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected failure: $($_.Exception.Message)" }
        return
    }
    throw "Expected failure matching $Pattern"
}
function Test-Case([string]$Name, [scriptblock]$Action) {
    & $Action
    $script:Passed++
    Write-Host "PASS $Name"
}
function New-ReadFixture([object[]]$Responses) {
    $state = @{ Calls = 0; Sleeps = [System.Collections.Generic.List[int]]::new(); Messages = [System.Collections.Generic.List[string]]::new(); Deadlines = [System.Collections.Generic.List[int]]::new() }
    # GetNewClosure creates a dynamic module. Capture the assertion itself;
    # script-local function names are not visible there under CI's nested
    # script invocation, even though they are visible under pwsh -File.
    $assertReadEqual = ${function:Assert-Equal}
    return @{
        State = $state
        Execute = {
            param($Executable, $Argv, $Deadline)
            $ErrorActionPreference = "Stop"
            & $assertReadEqual $Executable "gh" "read executable"
            & $assertReadEqual @($Argv) @("api", "repos/savethebeesandseeds/caatuu/commits/main", "--jq", ".sha") "read arguments"
            $state.Deadlines.Add($Deadline)
            $index = $state.Calls
            $state.Calls++
            if ($index -ge $Responses.Count) { throw "Unexpected extra execution" }
            return $Responses[$index]
        }.GetNewClosure()
        Sleep = { param($Seconds) $state.Sleeps.Add($Seconds) }.GetNewClosure()
        Notify = { param($Message) $state.Messages.Add($Message) }.GetNewClosure()
    }
}
function Invoke-Fixture($Fixture) {
    Invoke-CaatuuNetworkRead -File "gh" -Arguments @("api", "repos/savethebeesandseeds/caatuu/commits/main", "--jq", ".sha") `
        -Execute $Fixture.Execute -Sleep $Fixture.Sleep -Notify $Fixture.Notify
}

Test-Case "TLS timeout before upload recovers on the same read, with bounded backoff" {
    $fixture = New-ReadFixture @(
        @{ Code = 1; Output = 'Get "https://api.github.com/repos/savethebeesandseeds/caatuu/commits/main": net/http: TLS handshake timeout' },
        @{ Code = 0; Output = "a" * 40 }
    )
    $result = Invoke-Fixture $fixture
    Assert-Equal $result.Code 0 "recovered read status"
    Assert-Equal $result.Output ("a" * 40) "recovered commit"
    Assert-Equal $result.Attempts 2 "attempt count"
    Assert-Equal $fixture.State.Calls 2 "read executions"
    Assert-Equal @($fixture.State.Sleeps) @(2) "backoff"
    Assert-Equal @($fixture.State.Deadlines) @(60, 60) "per-attempt timeout"
}

Test-Case "closure assertions remain active and fail on an unexpected read" {
    $fixture = New-ReadFixture @(@{ Code = 0; Output = "must not return" })
    Assert-Throws {
        Invoke-CaatuuNetworkRead -File "gh" -Arguments @("repo", "view", "savethebeesandseeds/caatuu") `
            -Execute $fixture.Execute -Sleep $fixture.Sleep -Notify $fixture.Notify
    } "read arguments differs"
    Assert-Equal $fixture.State.Calls 0 "unexpected read rejected before simulated response"
}

Test-Case "selected throttling and gateway failures recover but never exceed three attempts" {
    foreach ($failure in @("HTTP 429: Too Many Requests", "HTTP 502: Bad Gateway", "HTTP 503: Service Unavailable", "connection reset by peer")) {
        $fixture = New-ReadFixture @(@{ Code = 1; Output = $failure }, @{ Code = 1; Output = $failure }, @{ Code = 0; Output = "ok" })
        Assert-Equal (Invoke-Fixture $fixture).Code 0 "transient recovery"
        Assert-Equal $fixture.State.Calls 3 "bounded executions"
        Assert-Equal @($fixture.State.Sleeps) @(2, 4) "bounded backoff"
    }
}

Test-Case "exhausted timeouts stop and preserve the final error" {
    $failure = @{ Code = 124; Output = "Read-only command timed out after 60s." }
    $fixture = New-ReadFixture @($failure, $failure, $failure)
    $result = Invoke-Fixture $fixture
    Assert-Equal $result.Code 124 "timeout result"
    Assert-Equal $result.Output $failure.Output "final error"
    Assert-Equal $result.Attempts 3 "exhausted attempt count"
    Assert-Equal @($fixture.State.Sleeps) @(2, 4) "no sleep after exhaustion"
}

Test-Case "authentication, certificate, missing and permanent failures never retry" {
    foreach ($failure in @(
        "HTTP 401: Bad credentials", "HTTP 403: Permission denied; timeout", "HTTP 404: Not Found",
        "HTTP 422: validation failed", "HTTP 501: Not Implemented", "x509: certificate signed by unknown authority",
        "unknown flag: --bad", "invalid JSON response"
    )) {
        $fixture = New-ReadFixture @(@{ Code = 1; Output = $failure })
        Assert-Equal (Invoke-Fixture $fixture).Code 1 "permanent failure"
        Assert-Equal $fixture.State.Calls 1 "no permanent retry"
        Assert-Equal $fixture.State.Sleeps.Count 0 "no permanent backoff"
    }
}

Test-Case "mutation and long-watch commands cannot enter the read retry path" {
    $called = @{ Count = 0 }
    foreach ($arguments in @(
        @("release", "upload", "tag", "file.apk"), @("release", "create", "tag"),
        @("release", "edit", "tag", "--draft=false"), @("workflow", "run", "pages.yml"),
        @("api", "repos/savethebeesandseeds/caatuu/commits/main", "-X", "POST"),
        @("api", "repos/savethebeesandseeds/caatuu/commits/main", "-f", "x=y"), @("run", "watch", "123"),
        @("release", "view", "tag", "--web")
    )) {
        Assert-Throws { Invoke-CaatuuNetworkRead -File "gh" -Arguments $arguments -Execute { $called.Count++; throw "Should not execute" } } "non-read command"
    }
    foreach ($arguments in @(
        @("-C", "C:\Work\caatuu", "push", "origin", "main"), @("fetch", "origin"),
        @("ls-remote", "--upload-pack=custom", "origin"), @("ls-remote", "--upload-pack", "custom", "origin"),
        @("ls-remote", "--upload-pa=custom", "origin"),
        @("ls-remote", "-u", "custom", "origin"), @("ls-remote", "-ucustom", "origin"),
        @("ls-remote", "--heads", "origin", "-u", "custom"), @("ls-remote", "--tags", "origin", "-ucustom"),
        @("-c", "uploadpack.packObjectsHook=custom", "ls-remote", "--heads", "origin"),
        @("ls-remote", "--heads", "https://elsewhere.example/repo.git"),
        @("ls-remote", "--server-option=custom", "--heads", "origin")
    )) {
        Assert-Equal (Test-CaatuuNetworkRead -File "git" -Arguments $arguments) $false "git mutation refusal"
    }
    Assert-Equal (Test-CaatuuNetworkRead -File "git" -Arguments @("-C", "C:\Work\caatuu", "ls-remote", "--heads", "origin")) $true "remote read allowlist"
    Assert-Equal (Test-CaatuuNetworkRead -File "git" -Arguments @("-C", "C:\Work\caatuu", "ls-remote", "--tags", "origin", "refs/tags/caatuu-android-166", "refs/tags/caatuu-android-166^{}")) $true "exact tag and peeled-tag reads"
    Assert-Equal (Test-CaatuuNetworkRead -File "git" -Arguments @("ls-remote", "--tags", "origin", "refs/tags/caatuu-android-166")) $true "exact tag read"
    Assert-Equal $called.Count 0 "no mutation execution"
}

Test-Case "real short-read process execution has a hard timeout and captures exit status" {
    $powershellPath = (Get-Process -Id $PID).Path
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $result = Invoke-CaatuuBoundedReadProcess -File $powershellPath -Arguments @("-NoProfile", "-Command", "Start-Sleep -Seconds 30") -TimeoutSeconds 1
    $watch.Stop()
    Assert-Equal $result.Code 124 "real timeout"
    if ($watch.Elapsed.TotalSeconds -gt 8) { throw "Read process timeout was not bounded" }
    $result = Invoke-CaatuuBoundedReadProcess -File $powershellPath -Arguments @("-NoProfile", "-Command", "[Console]::Out.Write('first value'); [Console]::Error.Write(' error'); exit 7") -TimeoutSeconds 10
    Assert-Equal $result.Code 7 "native exit code"
    Assert-Equal $result.Output "first value error" "captured native streams"
}

# Evaluate only these pure validation functions from the actual deployer. Never
# source its entrypoint or invoke an external command in reconciliation tests.
$deployerPath = Join-Path $PSScriptRoot "../deploy-pages-release.ps1"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($deployerPath, [ref]$tokens, [ref]$parseErrors)
Assert-Equal @($parseErrors).Count 0 "deployer syntax"
foreach ($name in @("Assert-ReleaseIdentity", "Assert-ServerAssets", "ConvertFrom-CheckedJson")) {
    $functionAst = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($null -eq $functionAst) { throw "Missing deployer validator $name" }
    . ([scriptblock]::Create($functionAst.Extent.Text))
}

Test-Case "actual Pages dispatch reconciles an accepted timeout without sending a duplicate" {
    $waitFunction = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Wait-PagesRun" }, $true)
    . ([scriptblock]::Create($waitFunction.Extent.Text))
    $Repository = "savethebeesandseeds/caatuu"
    $Workflow = "pages.yml"
    $head = "a" * 40
    $run = [pscustomobject]@{ databaseId = 123; headSha = $head; displayTitle = "Caatuu android · $head"; createdAt = "2026-09-07T01:00:00Z"; status = "completed"; conclusion = "success"; event = "workflow_dispatch"; url = "https://github.com/$Repository/actions/runs/123" }
    $state = @{ Dispatches = 0; Listings = 0; Sleeps = 0; Watches = 0; Appear = $true }
    function Get-WorkflowRuns {
        $state.Listings++
        if ($state.Listings -gt 1 -and $state.Appear) { return $run }
        return @()
    }
    function Assert-MainOnlyInvariant { param([switch]$CheckRemote) }
    function Get-WorktreeState { return @{ Kind = "clean" } }
    function Get-GitOutput { param($Arguments, $Label) return $head }
    function Start-Sleep { param($Seconds) $state.Sleeps++ }
    function Invoke-NativeResult {
        param($File, $Arguments)
        Assert-Equal @($Arguments[0], $Arguments[1]) @("workflow", "run") "single mutating command type"
        $state.Dispatches++
        return @{ Code = 1; Output = "net/http: TLS handshake timeout" }
    }
    function Invoke-Checked {
        param($File, $Arguments, $Label)
        if ($Arguments[0] -eq "api") { return $head }
        if ($Arguments[0] -eq "run" -and $Arguments[1] -eq "watch") { $state.Watches++; return "" }
        if ($Arguments[0] -eq "run" -and $Arguments[1] -eq "view") { return $run | ConvertTo-Json -Compress }
        throw "Unexpected external command in dispatch test"
    }
    Assert-Equal (Wait-PagesRun $head).databaseId 123 "reconciled run identity"
    Assert-Equal $state.Dispatches 1 "single timeout dispatch"
    Assert-Equal $state.Watches 1 "watch the accepted run"
    $state.Dispatches = 0
    $state.Listings = 0
    $state.Sleeps = 0
    $state.Watches = 0
    $state.Appear = $false
    Assert-Throws { Wait-PagesRun $head } "No duplicate dispatch was attempted"
    Assert-Equal $state.Dispatches 1 "unconfirmed write not repeated"
    Assert-Equal $state.Sleeps 30 "bounded reconciliation window"
    Assert-Equal $state.Watches 0 "no unrelated run watched"
}

Test-Case "uncertain upload is never resent and resumes only after exact server asset confirmation" {
    $calls = @{ Writes = 0; Reads = 0 }
    $expected = @([pscustomobject]@{ releaseAssetName = "caatuu-166.apk"; bytes = 123; sha256 = "a" * 64 })
    $remote = [pscustomobject]@{ tag_name = "caatuu-166"; prerelease = $false; draft = $true; assets = @([pscustomobject]@{ name = "caatuu-166.apk"; size = 123; digest = "sha256:" + ("a" * 64) }) }
    $result = Invoke-CaatuuMutationOnce -Label "upload" -Execute {
        $calls.Writes++
        return @{ Code = 1; Output = "connection reset by peer" }
    } -Reconcile {
        $calls.Reads++
        Assert-ReleaseIdentity $remote "caatuu-166"
        $present = Assert-ServerAssets $remote $expected -AllowMissing
        return $present.ContainsKey("caatuu-166.apk")
    }
    Assert-Equal $result.Code 0 "reconciled upload"
    Assert-Equal $calls.Writes 1 "single upload"
    Assert-Equal $calls.Reads 1 "server read"
}

Test-Case "missing, wrong-hash and wrong-tag server assets cannot mask an upload failure" {
    foreach ($mismatch in @("missing", "hash", "tag")) {
        $calls = @{ Writes = 0 }
        $expected = @([pscustomobject]@{ releaseAssetName = "caatuu-166.apk"; bytes = 123; sha256 = "a" * 64 })
        $remote = [pscustomobject]@{ tag_name = "caatuu-166"; prerelease = $false; assets = @([pscustomobject]@{ name = "caatuu-166.apk"; size = 123; digest = "sha256:" + ("a" * 64) }) }
        if ($mismatch -eq "missing") { $remote.assets = @() }
        if ($mismatch -eq "hash") { $remote.assets[0].digest = "sha256:" + ("b" * 64) }
        if ($mismatch -eq "tag") { $remote.tag_name = "wrong-tag" }
        Assert-Throws {
            Invoke-CaatuuMutationOnce -Label "upload" -Execute { $calls.Writes++; return @{ Code = 1; Output = "timeout" } } -Reconcile {
                Assert-ReleaseIdentity $remote "caatuu-166"
                $present = Assert-ServerAssets $remote $expected -AllowMissing
                return $present.ContainsKey("caatuu-166.apk")
            }
        } "failed"
        Assert-Equal $calls.Writes 1 "no blind upload retry"
    }
}

Test-Case "uncertain finalization accepts only the already-published exact release" {
    foreach ($published in @($true, $false)) {
        $calls = @{ Writes = 0 }
        $action = {
            Invoke-CaatuuMutationOnce -Label "finalization" -Execute { $calls.Writes++; return @{ Code = 1; Output = "TLS handshake timeout" } } -Reconcile { return $published }
        }
        if ($published) { Assert-Equal (& $action).Code 0 "published release recovery" }
        else { Assert-Throws $action "without a confirmed server result" }
        Assert-Equal $calls.Writes 1 "single finalization"
    }
    Assert-Throws {
        Invoke-CaatuuMutationOnce -Label "ambiguous reconciliation" -Execute { @{ Code = 1; Output = "timeout" } } -Reconcile { "not a verified identity"; $true }
    } "without a confirmed server result"
}

Test-Case "a thrown mutation callback propagates without any automatic resend" {
    $calls = @{ Writes = 0; Reads = 0 }
    Assert-Throws {
        Invoke-CaatuuMutationOnce -Label "thrown mutation" -Execute {
            $calls.Writes++
            throw "mutation transport callback threw"
        } -Reconcile { $calls.Reads++; return $true }
    } "mutation transport callback threw"
    Assert-Equal $calls.Writes 1 "single thrown mutation call"
    Assert-Equal $calls.Reads 0 "no assumed result after a thrown callback"
}

if (-not $NestedInvocation) {
    Test-Case "both behavior suites pass under CI's nested-script invocation with terminating errors" {
        $powershellPath = (Get-Process -Id $PID).Path
        $orchestrationPath = (Join-Path $PSScriptRoot "release-orchestration.test.ps1").Replace("'", "''")
        $networkPath = $PSCommandPath.Replace("'", "''")
        # GitHub's pwsh runner invokes its command script with Stop set outside
        # the two child scripts. Exercise that scope, not just -File execution.
        # The test-only switch prevents this subprocess check recursing; every
        # network behavior assertion still runs in the child process.
        $expectedCount = $script:Passed
        $command = "`$ErrorActionPreference = 'Stop'; & '$orchestrationPath'; & '$networkPath' -NestedInvocation"
        $result = Invoke-CaatuuBoundedReadProcess -File $powershellPath -Arguments @("-NoProfile", "-Command", $command) -TimeoutSeconds 20
        if ($result.Code -ne 0) { throw "CI-form behavior suite failed with exit $($result.Code).`n$($result.Output)" }
        $records = @($result.Output -split "`r?`n" | Where-Object { $_.StartsWith('{"schema":"caatuu-release-network-test-result"') })
        Assert-Equal $records.Count 1 "nested machine-readable result count"
        $completed = $records[0] | ConvertFrom-Json
        Assert-Equal $completed.passed $expectedCount "nested completed behavior count"
        Assert-Equal $completed.nested $true "nested invocation result identity"
        if ($result.Output -match 'not recognized as a name|Unexpected failure|Exception:') { throw "Nested invocation emitted an error despite its exit status.`n$($result.Output)" }
    }
}

Write-Host "Release network behavior tests: $script:Passed passed."
Write-Output ([ordered]@{ schema = "caatuu-release-network-test-result"; passed = $script:Passed; nested = [bool]$NestedInvocation } | ConvertTo-Json -Compress)
