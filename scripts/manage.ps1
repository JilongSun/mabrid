param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('setup', 'build', 'run', 'stop')][string]$Action,
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
        [IO.Directory]::CreateDirectory($ConfigDir) | Out-Null
        $target = Join-Path $ConfigDir 'mabrid.yaml'
        if (Test-Path -LiteralPath $target) {
            if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
                throw "Expected a regular file: $target"
            }
            Write-Output "Keeping existing $target"
        } else {
            Copy-Item -LiteralPath (Join-Path $Root 'mabrid.yaml.example') -Destination $target
            Write-Output "Created $target"
        }
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