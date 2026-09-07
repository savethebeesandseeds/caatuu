Set-StrictMode -Version Latest

# Keep automatic retries limited to short, read-only network commands. A new
# command type is not retryable until its semantics are explicitly reviewed.
function Test-CaatuuNetworkRead {
    param([string]$File, [string[]]$Arguments = @())
    $name = [System.IO.Path]::GetFileNameWithoutExtension($File).ToLowerInvariant()
    if ($name -eq "git") {
        $offset = if ($Arguments.Count -ge 2 -and $Arguments[0] -ceq "-C") { 2 } else { 0 }
        if ($Arguments.Count -le $offset -or $Arguments[$offset] -ne "ls-remote") { return $false }
        # Accept only the two exact remote-inventory forms used by the deployer.
        # In particular, --upload-pack (including accepted long abbreviations)
        # can select executable helpers. Unknown options are not retryable either.
        $readArgs = @($Arguments | Select-Object -Skip ($offset + 1))
        if ($readArgs.Count -lt 2 -or $readArgs[1] -ne "origin") { return $false }
        if ($readArgs[0] -eq "--heads") { return $readArgs.Count -eq 2 }
        if ($readArgs[0] -ne "--tags" -or $readArgs.Count -notin @(3, 4)) { return $false }
        foreach ($reference in $readArgs[2..($readArgs.Count - 1)]) {
            if ($reference -notmatch '^refs/tags/[A-Za-z0-9][A-Za-z0-9._/-]*(?:\^\{\})?$') { return $false }
        }
        return $true
    }
    if ($name -ne "gh" -or $Arguments.Count -lt 2) { return $false }
    if ($Arguments[0] -eq "api") {
        # gh api changes its default method when fields/input are supplied.
        if ($Arguments[1] -notmatch '^repos/savethebeesandseeds/caatuu/commits/[^\s]+$') { return $false }
        if ($Arguments.Count -ne 4 -or $Arguments[2] -ne "--jq" -or $Arguments[3] -ne ".sha") { return $false }
        return $true
    }
    if (@($Arguments | Where-Object { $_ -in @("--web", "-w") }).Count) { return $false }
    return (($Arguments[0] -eq "release" -and $Arguments[1] -eq "view") -or
        ($Arguments[0] -eq "repo" -and $Arguments[1] -eq "view") -or
        ($Arguments[0] -eq "run" -and $Arguments[1] -in @("list", "view")) -or
        ($Arguments[0] -eq "auth" -and $Arguments[1] -eq "status"))
}

function Test-CaatuuTransientReadFailure {
    param([int]$Code, [string]$Output)
    if ($Code -eq 0) { return $false }
    # Authentication, certificate validation and permanent HTTP errors override
    # incidental words such as "timeout" in an error response.
    if ($Output -match '(?i)bad credentials|authentication failed|not logged into|permission denied|certificate|\bx509\b|could not read Username') { return $false }
    $statuses = [regex]::Matches($Output, '(?i)\bHTTP(?:/\d(?:\.\d)?)?\s+(\d{3})\b')
    foreach ($status in $statuses) {
        if ([int]$status.Groups[1].Value -notin @(408, 429, 500, 502, 503, 504)) { return $false }
    }
    if ($statuses.Count -gt 0) { return $true }
    return $Output -match '(?i)TLS handshake timeout|connection (?:reset|timed out)|forcibly closed by the remote host|unexpected EOF|i/o timeout|context deadline exceeded|Read-only command timed out|net/http:.*timeout'
}

function Invoke-CaatuuBoundedReadProcess {
    param([string]$File, [string[]]$Arguments, [ValidateRange(1, 120)][int]$TimeoutSeconds = 60)
    $process = [System.Diagnostics.Process]::new()
    try {
        # Windows can expose several installations of one command on PATH.
        # Preserve normal command precedence and pass exactly one executable.
        $application = Get-Command $File -CommandType Application -ErrorAction Stop | Select-Object -First 1
        $process.StartInfo.FileName = $application.Source
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        foreach ($argument in $Arguments) { $process.StartInfo.ArgumentList.Add($argument) }
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true)
            if (-not $process.WaitForExit(5000)) { throw "Timed-out read-only process did not stop." }
            return [pscustomobject]@{ Code = 124; Output = "Read-only command timed out after ${TimeoutSeconds}s." }
        }
        if (-not $stdout.Wait(5000) -or -not $stderr.Wait(5000)) {
            return [pscustomobject]@{ Code = 124; Output = "Read-only command timed out while collecting its output." }
        }
        return [pscustomobject]@{ Code = $process.ExitCode; Output = ($stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()).TrimEnd() }
    }
    finally { $process.Dispose() }
}

function Invoke-CaatuuNetworkRead {
    param(
        [string]$File,
        [string[]]$Arguments,
        [string]$Label = "Release metadata read",
        [ValidateRange(1, 3)][int]$MaxAttempts = 3,
        [ValidateRange(1, 120)][int]$TimeoutSeconds = 60,
        [scriptblock]$Execute = { param($Executable, $Argv, $Deadline) Invoke-CaatuuBoundedReadProcess -File $Executable -Arguments $Argv -TimeoutSeconds $Deadline },
        [scriptblock]$Sleep = { param($Seconds) Start-Sleep -Seconds $Seconds },
        [scriptblock]$Notify = { param($Message) Write-Host $Message }
    )
    if (-not (Test-CaatuuNetworkRead -File $File -Arguments $Arguments)) { throw "Automatic network retry refused a non-read command: $File" }
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $result = & $Execute $File $Arguments $TimeoutSeconds
        if ($result.Code -eq 0 -or $attempt -eq $MaxAttempts -or
            -not (Test-CaatuuTransientReadFailure -Code $result.Code -Output $result.Output)) {
            return [pscustomobject]@{ Code = [int]$result.Code; Output = [string]$result.Output; Attempts = $attempt }
        }
        $delay = 2 * $attempt
        & $Notify "$Label encountered a transient network failure; retry $($attempt + 1)/$MaxAttempts in ${delay}s."
        & $Sleep $delay
    }
}

function Invoke-CaatuuMutationOnce {
    param([scriptblock]$Execute, [scriptblock]$Reconcile, [string]$Label)
    $result = & $Execute
    if ($result.Code -eq 0) { return $result }
    # An uncertain write is never blindly resent. The callback must verify the
    # exact intended server identity (tag, asset hash/size, or publication state).
    try { $confirmed = & $Reconcile }
    catch { throw "$Label failed and its server identity could not be reconciled. $($_.Exception.Message)" }
    if ($confirmed -isnot [bool] -or -not $confirmed) { throw "$Label failed without a confirmed server result.`n$($result.Output)" }
    return [pscustomobject]@{ Code = 0; Output = "Confirmed the exact server result after an uncertain response." }
}

Export-ModuleMember -Function Test-CaatuuNetworkRead, Test-CaatuuTransientReadFailure, Invoke-CaatuuBoundedReadProcess, Invoke-CaatuuNetworkRead, Invoke-CaatuuMutationOnce
