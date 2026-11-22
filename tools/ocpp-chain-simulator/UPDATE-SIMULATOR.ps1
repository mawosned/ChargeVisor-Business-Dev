# ChargeVisor OCPP simulator updater. Only simulator files are modified.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = 'mawosned/ChargeVisor-Business'
$branch = 'feature/mobilityhouse-ocpp-chain-tests'
$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
$gh = if ($ghCmd) { $ghCmd.Source } else { Join-Path $env:LOCALAPPDATA 'ChargeVisor\tools\gh\bin\gh.exe' }
if (-not (Test-Path $gh)) {
    $gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
}
if (-not (Test-Path $gh)) {
    throw 'GitHub CLI fehlt. Installiere sie über das einmalige PowerShell-Setup.'
}
& $gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'GitHub-Anmeldung erforderlich ...'
    & $gh auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) { throw 'GitHub-Anmeldung fehlgeschlagen' }
}
$files = @('desktop_simulator.py', 'chain_simulator.py', 'smart_charging.py',
    'ocpp_coverage.py', 'ocpp_test_console.py', 'ocpp_soak.py', 'paced_plan.py', 'requirements.txt',
    'test_chain_simulator.py', 'test_advanced_ocpp.py',
    'test_smart_charging.py', 'test_coverage.py', 'test_soak.py', 'test_paced_plan.py', 'test_tk_master.py',
    'START-SIMULATOR.cmd', 'start-local.ps1', 'README.md')
$stage = Join-Path $env:TEMP ('CV-ocpp-update-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
    Write-Host 'Lade die aktuelle OCPP-Testkonsole in den temporaeren Ordner ...'
    foreach ($name in $files) {
        $api = "repos/$repo/contents/tools/ocpp-chain-simulator/$($name)?ref=$branch"
        $raw = & $gh api $api
        if ($LASTEXITCODE -ne 0) { throw "GitHub-Download fehlgeschlagen: $name" }
        $file = ($raw | Out-String) | ConvertFrom-Json
        if (-not $file.content) { throw "GitHub-Inhalt fehlt: $name" }
        $bytes = [Convert]::FromBase64String(($file.content -replace '\s', ''))
        [IO.File]::WriteAllBytes((Join-Path $stage $name), $bytes)
    }
    $python = Join-Path $env:LOCALAPPDATA 'ChargeVisor\ocpp-chain-venv-fix\Scripts\python.exe'
    if (-not (Test-Path $python)) {
        $python = Join-Path $env:LOCALAPPDATA 'ChargeVisor\ocpp-chain-venv\Scripts\python.exe'
    }
    if (-not (Test-Path $python)) {
        $venv = Join-Path $env:LOCALAPPDATA 'ChargeVisor\ocpp-chain-venv'
        py -3 -m venv $venv
        if ($LASTEXITCODE -ne 0) { throw 'Python-Umgebung konnte nicht erstellt werden' }
        $python = Join-Path $venv 'Scripts\python.exe'
    }
    & $python -m pip install -r (Join-Path $stage 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python-Abhaengigkeiten fehlen' }

    Push-Location $stage
    try {
        & $python -m py_compile chain_simulator.py smart_charging.py ocpp_coverage.py ocpp_test_console.py ocpp_soak.py paced_plan.py desktop_simulator.py
        if ($LASTEXITCODE -ne 0) { throw 'Syntaxpruefung fehlgeschlagen. Alte Dateien unveraendert.' }
        # py_compile alone does NOT detect imports of missing Python modules.
        & $python -c "import paced_plan, ocpp_soak, ocpp_test_console, desktop_simulator; print('Import-Check OK')"
        if ($LASTEXITCODE -ne 0) { throw 'Importpruefung fehlgeschlagen. Alte Dateien unveraendert.' }
    } finally { Pop-Location }

    $backup = Join-Path $dir ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($name in $files) {
        $dest = Join-Path $dir $name
        if (Test-Path $dest) { Copy-Item -LiteralPath $dest -Destination $backup -Force }
        Copy-Item -LiteralPath (Join-Path $stage $name) -Destination $dest -Force
    }
    # Verify that every critical file actually reached the live simulator folder.
    foreach ($name in @('paced_plan.py', 'ocpp_soak.py', 'desktop_simulator.py', 'smart_charging.py')) {
        if (-not (Test-Path (Join-Path $dir $name))) {
            throw "Installation unvollstaendig: $name wurde nicht kopiert. Starte Python nicht."
        }
    }
    Write-Host "Update abgeschlossen. Sicherung: $backup"
    Push-Location $dir
    try {
        Write-Host 'Lokale Protokolltests und Coverage-Tests ...'
        & $python -m unittest discover -s . -p 'test_*.py' -v
        if ($LASTEXITCODE -ne 0) {
            Write-Warning 'Tests fehlgeschlagen. Bitte Log sichern; kein PASS-Nachweis.'
        }
        Write-Host 'Starte die neue Testkonsole ...'
        & $python desktop_simulator.py
        if ($LASTEXITCODE -ne 0) { throw 'Simulator mit Python-Fehler beendet' }
    } finally { Pop-Location }
} finally {
    if (Test-Path $stage) {
        Remove-Item -LiteralPath $stage -Force -Recurse -ErrorAction SilentlyContinue
    }
}
