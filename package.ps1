[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'package'),
    [string]$PrepareVersion
)

$ErrorActionPreference = 'Stop'
$projectName = 'CookieStorageManager'
$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
$legacyDirectory = Join-Path $PSScriptRoot 'legacy'
$diffDirectory = Join-Path $PSScriptRoot 'backup\diffs'
$gitExecutable = 'C:\Program Files\Git\cmd\git.exe'

$extensionFiles = @(
    'manifest.json'
    'background.js'
    'popup.html'
    'popup.js'
    'popup.css'
    'icon.png'
)
$extensionDirectories = @('_locales')

function Get-ManifestVersion {
    (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version
}

function Assert-ExtensionFiles {
    foreach ($relativePath in $extensionFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $relativePath) -PathType Leaf)) {
            throw "Required extension file is missing: $relativePath"
        }
    }
    foreach ($relativePath in $extensionDirectories) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $relativePath) -PathType Container)) {
            throw "Required extension directory is missing: $relativePath"
        }
    }
}

function Copy-ExtensionFiles([string]$Destination) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($relativePath in $extensionFiles) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $relativePath) -Destination $Destination
    }
    foreach ($relativePath in $extensionDirectories) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $relativePath) -Destination $Destination -Recurse
    }
}

Assert-ExtensionFiles
$currentVersion = Get-ManifestVersion
if ([string]::IsNullOrWhiteSpace($currentVersion)) {
    throw 'The version is missing from manifest.json.'
}

if ($PrepareVersion) {
    $parsedCurrent = $null
    $parsedNext = $null
    if (-not [version]::TryParse($currentVersion, [ref]$parsedCurrent) -or
        -not [version]::TryParse($PrepareVersion, [ref]$parsedNext) -or
        $parsedNext -le $parsedCurrent) {
        throw "PrepareVersion must be greater than the current version ($currentVersion)."
    }

    New-Item -ItemType Directory -Path $legacyDirectory -Force | Out-Null
    $archivePath = Join-Path $legacyDirectory $currentVersion
    if (Test-Path -LiteralPath $archivePath) {
        throw "Legacy snapshot already exists: legacy\$currentVersion"
    }
    Copy-ExtensionFiles $archivePath

    $manifestText = Get-Content -LiteralPath $manifestPath -Raw
    $escapedVersion = [regex]::Escape($currentVersion)
    $updatedManifest = [regex]::Replace(
        $manifestText,
        '("version"\s*:\s*")' + $escapedVersion + '(")',
        '${1}' + $PrepareVersion + '${2}',
        1
    )
    [System.IO.File]::WriteAllText($manifestPath, $updatedManifest, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Archived $currentVersion to legacy\$currentVersion"
    Write-Host "Prepared root working copy for version $PrepareVersion"
    Write-Host 'Make the new-version changes, then run .\package.ps1 to package and generate its diff.'
    exit 0
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "$projectName-$([guid]::NewGuid())"
$stagePath = Join-Path $tempRoot $currentVersion
try {
    Copy-ExtensionFiles $stagePath
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $resolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
    $zipPath = Join-Path $resolvedOutputDirectory "$projectName-$currentVersion.zip"
    Compress-Archive -Path (Join-Path $stagePath '*') -DestinationPath $zipPath -Force

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        if (-not ($archive.Entries | Where-Object FullName -eq 'manifest.json')) {
            throw 'manifest.json is not at the root of the package.'
        }
    }
    finally {
        $archive.Dispose()
    }

    $previous = Get-ChildItem -LiteralPath $legacyDirectory -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -as [version] } |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1

    if ($previous) {
        if (-not (Test-Path -LiteralPath $gitExecutable -PathType Leaf)) {
            throw "Git executable was not found: $gitExecutable"
        }
        New-Item -ItemType Directory -Path $diffDirectory -Force | Out-Null
        $diffPath = Join-Path $diffDirectory "$($previous.Name)-to-$currentVersion.patch"
        Copy-Item -LiteralPath $previous.FullName -Destination $tempRoot -Recurse
        Push-Location $tempRoot
        try {
            $diffOutput = & $gitExecutable -c core.autocrlf=false -c core.safecrlf=false diff --no-index --binary -- $previous.Name $currentVersion
        }
        finally {
            Pop-Location
        }
        if ($LASTEXITCODE -gt 1) {
            throw "git diff failed with exit code $LASTEXITCODE.`n$($diffOutput -join [Environment]::NewLine)"
        }
        [System.IO.File]::WriteAllLines($diffPath, [string[]]$diffOutput, [System.Text.UTF8Encoding]::new($false))
        Write-Host "Diff created: $diffPath"
    }

    Write-Host "Package created: $zipPath"
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
