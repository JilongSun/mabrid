param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('setup', 'build', 'run', 'recreate', 'stop')][string]$Action,
    [string]$ConfigDir = (Split-Path -Parent $PSScriptRoot),
    [string]$Image = 'mabrid:local',
    [string]$Name = 'mabrid',
    [ValidateRange(1, 65535)][int]$Port = 8765,
    [ValidateRange(1, 86400)][int]$Timeout = 90
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not [IO.Path]::IsPathRooted($ConfigDir)) {
    $ConfigDir = Join-Path (Get-Location).Path $ConfigDir
}
$ConfigDir = [IO.Path]::GetFullPath($ConfigDir)
if ($Name -cnotmatch '^[a-z0-9][a-z0-9_-]*$') {
    throw 'Use a lowercase Docker project name'
}

function Invoke-Docker {
    param([string[]]$DockerArguments, [switch]$Live)
    if ($Live) {
        & docker @DockerArguments
        if ($LASTEXITCODE -ne 0) { throw 'Docker command failed; see output above' }
        return
    }
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & docker @DockerArguments 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($code -ne 0) {
        throw (($output | Out-String).Trim())
    }
    if (-not $Live) { return (($output | Out-String).Trim()) }
}

function Invoke-Compose {
    param([string[]]$ComposeArguments, [switch]$Live)
    Invoke-Docker -DockerArguments ($script:ComposeBase + $ComposeArguments) -Live:$Live
}

function Confirm-Owner {
    param([string]$Resource, [string]$ObjectName)
    if ($Resource -eq 'container') {
        $names = Invoke-Docker -DockerArguments @('container', 'ls', '--all', '--format', '{{.Names}}')
        $format = '{{json .Config.Labels}}'
    } else {
        $names = Invoke-Docker -DockerArguments @('volume', 'ls', '--format', '{{.Name}}')
        $format = '{{json .Labels}}'
    }
    if (($names -split '\r?\n') -contains $ObjectName) {
        $labels = (Invoke-Docker -DockerArguments @($Resource, 'inspect', '--format', $format, $ObjectName)) | ConvertFrom-Json
        if ($labels.'io.mabrid.config-directory' -ne $ConfigDir -or $labels.'com.docker.compose.project' -ne $Name) {
            throw "$Resource $ObjectName is not owned by this deployment"
        }
    }
}

try {
    if ($Action -eq 'setup') {
        $runtimeDirectory = Join-Path $ConfigDir 'runtime'
        $runtimeTarget = Join-Path $runtimeDirectory 'mabrid.runtime.yaml'
        if ((Test-Path -LiteralPath (Join-Path $ConfigDir 'mabrid.runtime.yaml')) -and -not (Test-Path -LiteralPath $runtimeTarget)) {
            throw 'Existing adjacent runtime file kept. Explicitly move it to runtime/mabrid.runtime.yaml and set runtimeConfigFile before using the container layout.'
        }
        [IO.Directory]::CreateDirectory($ConfigDir) | Out-Null
        $unixHost = [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT
        if (Test-Path -LiteralPath $runtimeDirectory) {
            if (-not (Test-Path -LiteralPath $runtimeDirectory -PathType Container) -or (Get-Item -LiteralPath $runtimeDirectory).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
                throw "Expected a real directory: $runtimeDirectory"
            }
        } else {
            [IO.Directory]::CreateDirectory($runtimeDirectory) | Out-Null
            if ($unixHost) {
                & chmod 2770 $runtimeDirectory
                if ($LASTEXITCODE -ne 0) { throw 'Unable to set runtime directory permissions' }
            }
        }
        foreach ($file in @('mabrid.yaml', 'runtime/mabrid.runtime.yaml')) {
            $target = Join-Path $ConfigDir $file
            if (Test-Path -LiteralPath $target) {
                if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
                    throw "Expected a regular file: $target"
                }
                Write-Output "Keeping existing $target"
            } else {
                $template = (Split-Path -Leaf $file) + '.example'
                Copy-Item -LiteralPath (Join-Path $Root $template) -Destination $target
                if ($unixHost -and $file -eq 'runtime/mabrid.runtime.yaml') {
                    & chmod 660 $target
                    if ($LASTEXITCODE -ne 0) { throw 'Unable to set runtime file permissions' }
                }
                Write-Output "Created $target"
            }
        }
        $envTarget = Join-Path $ConfigDir '.env'
        if (Test-Path -LiteralPath $envTarget) {
            if (-not (Test-Path -LiteralPath $envTarget -PathType Leaf)) {
                throw "Expected a regular file: $envTarget"
            }
            Write-Output "Keeping existing $envTarget"
        } else {
            $envContent = @(
                '# Container runtime secrets. Values are injected as environment variables,'
                '# not mounted as a file. Set variables referenced by Host apiKeyEnv, for example:'
                '# API_SERVER_KEY='
            ) -join "`n"
            [IO.File]::WriteAllText($envTarget, $envContent + "`n")
            Write-Output "Created $envTarget"
        }
        Write-Output 'Configure mabrid.yaml and runtime/mabrid.runtime.yaml. Existing files and permissions are preserved; Unix runtime directories need group writes and setgid, and Windows directories need operator-managed ACL protection.'
        exit 0
    }
    if (-not (Test-Path -LiteralPath $ConfigDir -PathType Container)) {
        throw 'Configuration directory is missing; run setup first'
    }
    $ConfigDir = (Get-Item -LiteralPath $ConfigDir).FullName
    if ($Action -ne 'stop') {
        if (-not (Test-Path -LiteralPath (Join-Path $ConfigDir 'mabrid.yaml') -PathType Leaf)) {
            throw 'Run setup first'
        }
    }
    if ($Action -in @('run', 'recreate')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ConfigDir 'runtime/mabrid.runtime.yaml') -PathType Leaf)) {
            throw 'Run setup first; the container layout requires runtime/mabrid.runtime.yaml and an explicit runtimeConfigFile setting'
        }
    }
    $env:MABRID_CONFIG_GID = '10001'
    if ($Action -ne 'stop' -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        $groupArguments = if ($IsMacOS) { @('-f', '%g') } else { @('-c', '%g') }
        $env:MABRID_CONFIG_GID = (& stat @groupArguments (Join-Path $ConfigDir 'runtime')).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Unable to determine runtime directory group' }
    }
    Get-Command docker -ErrorAction Stop | Out-Null
    if ((Invoke-Docker -DockerArguments @('info', '--format', '{{.OSType}}')) -ne 'linux') {
        throw 'Select a Docker context using Linux containers'
    }
    $version = Invoke-Docker -DockerArguments @('compose', 'version', '--short')
    if ([version]($version.TrimStart('v').Split('-')[0]) -lt [version]'2.30.0') {
        throw 'Docker Compose 2.30+ is required'
    }
    if ($ConfigDir.Contains(',')) { throw 'Docker bind mount paths cannot contain commas' }
    $env:MABRID_CONFIG_DIR = $ConfigDir
    $env:MABRID_IMAGE = $Image
    $env:MABRID_NAME = $Name
    $env:MABRID_PORT = [string]$Port
    $script:ComposeBase = @(
        'compose', '--project-name', $Name, '--project-directory', $Root,
        '--file', (Join-Path $Root 'compose.yaml')
    )
    switch ($Action) {
        'build' {
            Invoke-Compose -ComposeArguments @('build', 'mabrid') -Live
        }
        'run' {
            try {
                $imageOs = Invoke-Docker -DockerArguments @('image', 'inspect', '--format', '{{.Os}}', $Image)
            } catch { throw 'Local image missing; run build first' }
            if ($imageOs -ne 'linux') { throw 'A Linux image is required; run build first' }
            Confirm-Owner 'container' $Name
            Confirm-Owner 'volume' "$Name-data"
            if (Invoke-Compose -ComposeArguments @('ps', '--status', 'running', '--quiet', 'mabrid')) {
                throw 'Already running; use stop before run'
            }
            Invoke-Compose -ComposeArguments @(
                'up', '--detach', '--wait', '--wait-timeout', [string]$Timeout,
                '--no-build', '--pull', 'never', 'mabrid'
            ) -Live
            Write-Output "Started $Name; port mapping http://localhost:$Port (application readiness is not checked)."
        }
        'recreate' {
            try {
                $imageOs = Invoke-Docker -DockerArguments @('image', 'inspect', '--format', '{{.Os}}', $Image)
            } catch { throw 'Local image missing; run build first' }
            if ($imageOs -ne 'linux') { throw 'A Linux image is required; run build first' }
            Confirm-Owner 'container' $Name
            Confirm-Owner 'volume' "$Name-data"
            if (Invoke-Compose -ComposeArguments @('ps', '--status', 'running', '--quiet', 'mabrid')) {
                Invoke-Compose -ComposeArguments @('stop', '--timeout', '20', 'mabrid') -Live
                $code = Invoke-Docker -DockerArguments @('container', 'inspect', '--format', '{{.State.ExitCode}}', $Name)
                if ($code -notin @('0', '143')) { throw 'Container did not stop gracefully; inspect Docker logs' }
                $logs = Invoke-Docker -DockerArguments @('logs', $Name)
                if (-not $logs.Contains('Application shutdown complete.')) {
                    throw 'Application shutdown completion was not verified'
                }
            }
            Invoke-Compose -ComposeArguments @(
                'up', '--detach', '--wait', '--wait-timeout', [string]$Timeout,
                '--force-recreate', '--no-build', '--pull', 'never', 'mabrid'
            ) -Live
            Write-Output "Recreated $Name; volume $Name-data is preserved."
        }
        'stop' {
            Confirm-Owner 'container' $Name
            if (-not (Invoke-Compose -ComposeArguments @('ps', '--status', 'running', '--quiet', 'mabrid'))) {
                Write-Output "$Name is already stopped; data is preserved."
                exit 0
            }
            Invoke-Compose -ComposeArguments @('stop', '--timeout', '20', 'mabrid') -Live
            $code = Invoke-Docker -DockerArguments @('container', 'inspect', '--format', '{{.State.ExitCode}}', $Name)
            if ($code -notin @('0', '143')) { throw 'Container did not stop gracefully; inspect Docker logs' }
            $logs = Invoke-Docker -DockerArguments @('logs', $Name)
            if (-not $logs.Contains('Application shutdown complete.')) {
                throw 'Application shutdown completion was not verified'
            }
            Write-Output "Stopped $Name; volume $Name-data is preserved."
        }
    }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}