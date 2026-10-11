[CmdletBinding()]
param([string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'SelfAgent'))

$ErrorActionPreference = 'Stop'
$version = '0.150.1'
if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'Windows x64 PowerShell is required.'
}
$resolvedRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$vendor = Join-Path $resolvedRoot '.runtime/vendor'
$binary = Join-Path $vendor 'x86_64-pc-windows-msvc/bin/codex.exe'
function Confirm-Version([string]$Executable) {
    $result = & $Executable --version
    if ($LASTEXITCODE -ne 0 -or $result.Trim() -ne "codex-cli $version") {
        throw "Unsupported runtime: $result. Expected codex-cli $version. Existing files were not overwritten."
    }
}
if (Test-Path -LiteralPath $binary) {
    Confirm-Version $binary
    Write-Host "Reusing Codex $version at $binary"
    return
}
if (Test-Path -LiteralPath $vendor) {
    throw "Incomplete runtime at $vendor. Inspect and relocate it before retrying; existing files were not overwritten."
}
Get-Command npm.cmd, tar.exe -ErrorAction Stop | Out-Null
$stage = Join-Path ([IO.Path]::GetTempPath()) ('ollama-sidebar-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    # The platform package includes Codex and its Windows execution helpers.
    & npm.cmd pack "@openai/codex@$version-win32-x64" --pack-destination $stage --cache (Join-Path $stage 'npm-cache') --ignore-scripts --silent
    if ($LASTEXITCODE -ne 0) { throw 'Failed to download the official Codex npm package.' }
    $archive = @(Get-ChildItem -LiteralPath $stage -Filter '*.tgz')
    if ($archive.Count -ne 1) { throw 'Expected one npm package archive.' }
    & tar.exe -xzf $archive[0].FullName -C $stage
    if ($LASTEXITCODE -ne 0) { throw 'Failed to extract Codex.' }
    $sourceVendor = Join-Path $stage 'package/vendor'
    Confirm-Version (Join-Path $sourceVendor 'x86_64-pc-windows-msvc/bin/codex.exe')
    New-Item -ItemType Directory -Path (Split-Path $vendor) -Force | Out-Null
    if (Test-Path -LiteralPath $vendor) { throw 'Runtime destination appeared during installation; retry after inspection.' }
    Move-Item -LiteralPath $sourceVendor -Destination $vendor
    Confirm-Version $binary
    Write-Host "Installed Codex $version at $binary"
} finally {
    $checkedStage = [IO.Path]::GetFullPath($stage)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($checkedStage.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $checkedStage -Leaf) -match '^ollama-sidebar-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $checkedStage -Recurse -Force
    }
}
