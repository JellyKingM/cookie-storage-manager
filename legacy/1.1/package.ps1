[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'package')
)

$ErrorActionPreference = 'Stop'

$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

if ([string]::IsNullOrWhiteSpace($version)) {
    throw 'The version is missing from manifest.json.'
}

$requiredFiles = @(
    'manifest.json'
    'background.js'
    'content.js'
    'shared.js'
    'options.html'
    'options.js'
    'popup.html'
    'Icon.png'
)

$requiredDirectories = @(
    '_locales'
)

foreach ($relativePath in $requiredFiles) {
    $sourcePath = Join-Path $PSScriptRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required file is missing: $relativePath"
    }
}

foreach ($relativePath in $requiredDirectories) {
    $sourcePath = Join-Path $PSScriptRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
        throw "Required directory is missing: $relativePath"
    }
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$resolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$archivePath = Join-Path $resolvedOutputDirectory "InstagramVideoController-$version.zip"
$stagePath = Join-Path ([System.IO.Path]::GetTempPath()) "InstagramVideoController-$version-$([guid]::NewGuid())"

try {
    New-Item -ItemType Directory -Path $stagePath | Out-Null

    foreach ($relativePath in $requiredFiles) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $relativePath) -Destination $stagePath
    }

    foreach ($relativePath in $requiredDirectories) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $relativePath) -Destination $stagePath -Recurse
    }

    Compress-Archive -Path (Join-Path $stagePath '*') -DestinationPath $archivePath -Force

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $manifestEntry = $archive.Entries | Where-Object { $_.FullName -eq 'manifest.json' }
        if (-not $manifestEntry) {
            throw 'manifest.json is not at the root of the archive.'
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    if (Test-Path -LiteralPath $stagePath) {
        Remove-Item -LiteralPath $stagePath -Recurse -Force
    }
}

Write-Host "Package created: $archivePath"
