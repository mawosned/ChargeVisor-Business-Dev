# Publishes a clean, history-free DEVELOPMENT COPY of ChargeVisor.
# The existing private repository and its Render-linked main are NEVER modified.
# Requires an authenticated GitHub CLI and Git for Windows.
$ErrorActionPreference = 'Stop'
$privateRepo = 'mawosned/ChargeVisor-Business'
$sourceBranch = 'dev/public-snapshot-source-2026-11-22'
$publicRepo = 'mawosned/ChargeVisor-Business-Dev'

function Run([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Befehl fehlgeschlagen ($LASTEXITCODE): $exe $($arguments[0])"
    }
}

$ghCommand = Get-Command gh.exe -ErrorAction SilentlyContinue
$gh = if ($ghCommand) { $ghCommand.Source } else {
    Join-Path $env:LOCALAPPDATA 'ChargeVisor\tools\gh\bin\gh.exe'
}
if (-not (Test-Path $gh)) {
    $gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
}
if (-not (Test-Path $gh)) { throw 'GitHub CLI wurde nicht gefunden.' }

$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
$git = if ($gitCommand) { $gitCommand.Source } else {
    Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
}
if (-not (Test-Path $git)) { throw 'Git for Windows wurde nicht gefunden.' }
$env:PATH = (Split-Path -Parent $git) + ';' + $env:PATH

Run $gh @('auth', 'status')
$login = (& $gh api user --jq '.login' | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $login -ne 'mawosned') {
    throw "Falscher GitHub-Account: '$login'. Erwartet: mawosned"
}

Write-Host 'Original bleibt PRIVAT. Render und der main-Branch bleiben UNBERUEHRT.' -ForegroundColor Cyan
Write-Host "Neue OEFFENTLICHE Entwicklungskopie: $publicRepo" -ForegroundColor Cyan

# Non-destructive: never overwrite an existing public repository.
# Listing owned repos avoids a native stderr exception for the expected 404.
$existingNames = @(& $gh repo list mawosned --limit 200 --json name --jq '.[].name')
if ($LASTEXITCODE -ne 0) { throw 'GitHub-Repositories konnten nicht geprueft werden.' }
if ($existingNames -contains 'ChargeVisor-Business-Dev') {
    Write-Host "Das Ziel-Repository existiert bereits: https://github.com/$publicRepo" -ForegroundColor Yellow
    Write-Host 'Keine vorhandenen Dateien, Branches oder Remotes veraendert.'
    exit 0
}

$stage = Join-Path $env:TEMP ('chargevisor-public-source-' + [Guid]::NewGuid().ToString('N'))
$src = Join-Path $stage 'source'
$dst = Join-Path $env:USERPROFILE 'ChargeVisor-Business-Dev'
if (Test-Path -LiteralPath $dst) {
    throw "Lokaler Zielordner existiert bereits: $dst. Keine Daten ueberschrieben."
}

New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
    Write-Host '1/5 Lade den vorbereiteten Entwicklungsstand (nur ein Git-Commit) ...'
    Run $gh @('repo', 'clone', $privateRepo, $src, '--',
              '--depth', '1', '--single-branch', '--branch', $sourceBranch)

    # Copy only files tracked by the checked-out snapshot. No .git history or
    # ignored local .env/credentials files are exported.
    $tracked = @(& $git -C $src -c 'core.quotepath=false' ls-files)
    if ($LASTEXITCODE -ne 0 -or $tracked.Count -lt 35) {
        throw "Git-Liste fehlt oder ist unplausibel: $($tracked.Count) Dateien"
    }
    foreach ($rel in $tracked) {
        if ($rel -match '(^|/)(\.env($|\.)|\.npmrc$|id_rsa$|id_ed25519$|credentials\.json$)' -or
            $rel -match '(?i)\.(pem|p12|pfx|p8|key|sqlite|sqlite3|db)$') {
            throw "VEROEFFENTLICHUNG BLOCKIERT: moegliche Zugangsdaten-Datei: $rel"
        }
    }

    Write-Host '2/5 Pruefe den Snapshot auf typische hartcodierte Geheimnisse ...'
    $patterns = @(
        '(?i)(?:ghp_|github_pat_)[a-zA-Z0-9_]{20,}',
        '(?i)\bsk-(?:proj-)?[a-zA-Z0-9_-]{30,}',
        '\bAKIA[0-9A-Z]{16}\b',
        '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        '(?i)\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^:\s@]+:[^@\s]{6,}@(?!localhost\b|127\.0\.0\.1\b)'
    )
    foreach ($rel in $tracked) {
        if ($rel -notmatch '(?i)(\.mjs|\.js|\.json|\.md|\.yml|\.yaml|\.txt|\.py|\.ps1|\.cmd|\.html|\.css|\.sh|\.xml|\.toml|\.gitignore|Dockerfile)$') {
            continue
        }
        $absolute = Join-Path $src $rel
        $body = [IO.File]::ReadAllText($absolute)
        foreach ($pattern in $patterns) {
            if ([regex]::IsMatch($body, $pattern)) {
                throw "VEROEFFENTLICHUNG BLOCKIERT: potentielles Secret in $rel"
            }
        }
    }

    Write-Host '3/5 Erstelle neue lokale Kopie ohne die bisherige Git-Historie ...'
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    foreach ($rel in $tracked) {
        $from = Join-Path $src $rel
        $to = Join-Path $dst $rel
        $parent = Split-Path -Parent $to
        if (-not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
        }
        Copy-Item -LiteralPath $from -Destination $to -Force
    }
    Run $git @('-C', $dst, 'init', '-q')
    Run $git @('-C', $dst, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    Run $git @('-C', $dst, 'add', '--all')
    Run $git @('-C', $dst, '-c', 'user.name=ChargeVisor Development',
               '-c', 'user.email=development@users.noreply.github.com',
               'commit', '-q', '-m', 'Initial public development snapshot (new history, private original retained)')

    # Local verification is a bonus. Never call an unavailable Node installation a PASS.
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npm) {
        Write-Host '4/5 Fuehre lokale Backend-Regressionstests aus ...'
        Push-Location $dst
        try {
            & $npm.Source ci --ignore-scripts
            if ($LASTEXITCODE -eq 0) {
                & $npm.Source test
                if ($LASTEXITCODE -eq 0) {
                    Write-Host 'Lokale Backend-Tests: PASS' -ForegroundColor Green
                } else {
                    Write-Warning 'Lokale Backend-Tests fehlgeschlagen. Der Code wird nur in die neue Entwicklungskopie uebertragen.'
                }
            } else {
                Write-Warning 'npm ci fehlgeschlagen; GitHub soll die Tests ebenfalls pruefen.'
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Warning 'Node/npm auf diesem PC nicht gefunden. GitHub Actions wird die Tests pruefen, falls Kontobilling sie zulaesst.'
    }

    Write-Host '5/5 Erstelle Oeffentliches GitHub-Repository und pushe den frischen Snapshot ...'
    Run $gh @('repo', 'create', $publicRepo, '--public',
              '--source', $dst, '--remote', 'origin', '--push',
              '--description', 'Isolated public development and OCPP 1.6J regression tests. Production remains private.')

    $infoText = (& $gh api "repos/$publicRepo" | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'GitHub Repo konnte nicht bestaetigt werden.' }
    $info = $infoText | ConvertFrom-Json
    if ($info.private -ne $false) { throw 'SICHTBARKEIT NICHT OEFFENTLICH - bitte pruefen.' }
    Write-Host ''
    Write-Host "OEFFENTLICHE KOPIE ERSTELLT: $($info.html_url)" -ForegroundColor Green
    Write-Host "LOKAL: $dst"
    Write-Host "PRIVATES ORIGINAL: https://github.com/$privateRepo" -ForegroundColor Cyan
    Write-Host "Render bleibt auf dem privaten Original und wird nicht neu deployed."
    Write-Host 'Pruefe neu ausgeloeste GitHub Actions:'
    & $gh run list --repo $publicRepo --limit 6
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'GitHub Actions-Abfrage fehlgeschlagen: eventuell blockiert GitHub Billing auch im oeffentlichen Repository.'
    }
} finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
