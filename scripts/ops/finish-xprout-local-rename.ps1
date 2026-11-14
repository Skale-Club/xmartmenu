#requires -Version 7.0
# Run in a separate PowerShell 7 window after closing Codex. No network or deployment.
[CmdletBinding()]
param([switch]$ConsolidateDrive)
$ErrorActionPreference = 'Stop'
$oldRoot = 'C:\Users\Vanildo\Dev\xmartmenu'
$newRoot = 'C:\Users\Vanildo\Dev\xprout'
Set-Location -LiteralPath 'C:\Users\Vanildo\Dev'

# A failed Windows rename left only this empty destination scaffold. Never delete contents.
if ((Test-Path -LiteralPath $newRoot) -and -not (Test-Path -LiteralPath "$newRoot\.git\HEAD")) {
    $children = @(Get-ChildItem -LiteralPath $newRoot -Force)
    if ($children.Count -eq 1 -and $children[0].Name -eq '.git' -and
        @(Get-ChildItem -LiteralPath $children[0].FullName -Force).Count -eq 0) {
        Remove-Item -LiteralPath $children[0].FullName -Force
    }
    if (@(Get-ChildItem -LiteralPath $newRoot -Force).Count -ne 0) {
        throw 'Destination contains data; refusing to overwrite it.'
    }
    Remove-Item -LiteralPath $newRoot
}
if (Test-Path -LiteralPath "$oldRoot\.git\HEAD") {
    if (Test-Path -LiteralPath $newRoot) { throw 'Both checkouts exist; refusing to choose one.' }
    $before = & git -C $oldRoot rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Git preflight failed.' }
    Rename-Item -LiteralPath $oldRoot -NewName 'xprout'
} elseif (Test-Path -LiteralPath "$newRoot\.git\HEAD") {
    $before = & git -C $newRoot rev-parse HEAD
} else { throw 'Checkout missing at both expected paths.' }
$after = & git -C $newRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $after -ne $before) { throw 'Git verification failed.' }

# Preserve the existing project ID/chat association; edit only its name and root path.
$statePath = Join-Path $env:USERPROFILE '.codex\.codex-global-state.json'
if (Test-Path -LiteralPath $statePath) {
    $stateRaw = [IO.File]::ReadAllText($statePath)
    $state = $stateRaw | ConvertFrom-Json -AsHashtable
    $project = $state['local-projects']['738f90b2-e0eb-444f-91fc-1b4d6d1c1d19']
    if ($project -and $project['rootPaths'] -contains $oldRoot) {
        Copy-Item -LiteralPath $statePath -Destination "$statePath.before-xprout-rename" -ErrorAction Stop
        $project['name'] = 'Xprout'
        $project['rootPaths'] = @($project['rootPaths'] | ForEach-Object { if ($_ -eq $oldRoot) { $newRoot } else { $_ } })
        $project['updatedAt'] = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 100 -Compress))
    }
}
$configPath = Join-Path $env:USERPROFILE '.codex\config.toml'
if (Test-Path -LiteralPath $configPath) {
    $configRaw = [IO.File]::ReadAllText($configPath)
    $updated = $configRaw.Replace($oldRoot, $newRoot).Replace('C:/Users/Vanildo/Dev/xmartmenu', 'C:/Users/Vanildo/Dev/xprout')
    if ($updated -ne $configRaw) {
        Copy-Item -LiteralPath $configPath -Destination "$configPath.before-xprout-rename"
        [IO.File]::WriteAllText($configPath, $updated)
    }
}

if ($ConsolidateDrive) {
    $driveOld = 'N:\My Drive\Dev\xmartmenu'
    $driveNew = 'N:\My Drive\Xprout\Runtime'
    if (Test-Path -LiteralPath $driveNew) { throw 'Drive Runtime destination already exists.' }
    if (-not (Test-Path -LiteralPath "$driveOld\.env.local")) { throw 'Drive environment source missing.' }
    if (-not (Test-Path -LiteralPath 'N:\My Drive\Xprout')) { throw 'Owner-designated Drive root missing.' }
    # Both absolute paths are fixed inside the explicitly named Drive project directories.
    Move-Item -LiteralPath $driveOld -Destination $driveNew
    $env:XPROUT_RENAME_LINK = "$newRoot\.env.local"
    $env:XPROUT_RENAME_SOURCE = "$driveNew\.env.local"
    @'
import os, pathlib, re, shutil
link = pathlib.Path(os.environ['XPROUT_RENAME_LINK'])
source = pathlib.Path(os.environ['XPROUT_RENAME_SOURCE'])
assert link.is_symlink(), 'Refusing to replace a real environment file'
assert source.is_file(), 'Drive environment file missing'
raw = source.read_bytes()
match = re.search(rb'(?m)^AR_MODELS_DIR\s*=[^\r\n]*', raw)
if match:
    old = match.group(0)
    new = old.replace(b'N:/My Drive/Dev/xmartmenu', b'N:/My Drive/Xprout/Runtime').replace(
        b'N:\\My Drive\\Dev\\xmartmenu', b'N:\\My Drive\\Xprout\\Runtime')
    if old != new:
        backup = source.with_name('.env.local.before-xprout-rename')
        assert not backup.exists(), 'Environment backup already exists'
        shutil.copy2(source, backup)
        source.write_bytes(raw.replace(old, new, 1))
previous = os.readlink(link)
os.remove(link)
try:
    os.symlink(str(source), str(link))
except OSError:
    os.symlink(previous, str(link))
    raise
assert link.is_file() and link.resolve() == source.resolve()
print('Drive environment link verified; no credentials printed.')
'@ | python -
    if ($LASTEXITCODE -ne 0) { throw 'Drive environment verification failed; inspect the preserved files before restarting.' }
}
Write-Output "Checkout verified at $newRoot; commit $after. Reopen this folder in Codex."
