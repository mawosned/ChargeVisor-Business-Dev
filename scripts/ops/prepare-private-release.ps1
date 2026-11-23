# Creates an UNMERGED PR in the PRIVATE repository, never a production deploy.
# Requires authenticated mawosned GitHub CLI, Windows Git, Node.js and npm.
param([string]$ExpectedDevSha='')
$ErrorActionPreference='Stop'
$public='mawosned/ChargeVisor-Business-Dev'
$private='mawosned/ChargeVisor-Business'
$ghCmd=Get-Command gh.exe -ErrorAction SilentlyContinue
$gh=if($ghCmd){$ghCmd.Source}else{Join-Path $env:LOCALAPPDATA 'ChargeVisor\tools\gh\bin\gh.exe'}
$gitCmd=Get-Command git.exe -ErrorAction SilentlyContinue
$git=if($gitCmd){$gitCmd.Source}else{Join-Path $env:ProgramFiles 'Git\cmd\git.exe'}
$node=Get-Command node.exe -ErrorAction SilentlyContinue
$npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
if(!(Test-Path $gh)-or !(Test-Path $git)-or !$node -or !$npm){
    throw 'GitHub CLI, Git, Node und npm sind erforderlich'
}
function Run([string]$exe,[string[]]$arg){
    & $exe @arg
    if($LASTEXITCODE -ne 0){throw "Befehl fehlgeschlagen: $exe $($arg[0])"}
}
Run $gh @('auth','status')
$login=(& $gh api user --jq '.login' | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $login -ne 'mawosned'){throw 'Falscher GitHub-Account'}
$sha=(& $gh api "repos/$public/commits/main" --jq '.sha' | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $sha -notmatch '^[a-f0-9]{40}$'){throw 'Dev-Commit unlesbar'}
if($ExpectedDevSha -and $ExpectedDevSha -ne $sha){throw 'Dev-SHA weicht von gepruefter Version ab'}
$ci=((& $gh api "repos/$public/actions/runs?per_page=100" | Out-String)|ConvertFrom-Json)
if($LASTEXITCODE -ne 0){throw 'Actions-Check unmoeglich'}
$runs=@($ci.workflow_runs|Where-Object{$_.head_sha -eq $sha})
$required=@('Backend regression guard','ChargeVisor checks',
  'OCPP desktop simulator regression','Independent Mobility House OCPP 1.6J Integration',
  'ChargeVisor V1 WEG ten-connector acceptance',
  'ChargeVisor disaster recovery - encrypted backup and actual restore')
foreach($name in $required){
    $pass=@($runs|Where-Object{$_.name -eq $name -and
      $_.status -eq 'completed' -and $_.conclusion -eq 'success'})
    if($pass.Count -lt 1){throw "Release blockiert: CI $name"}
}
$stage=Join-Path $env:TEMP ('cv-release-'+[guid]::NewGuid().ToString('N'))
$from=Join-Path $stage 'dev'
$to=Join-Path $stage 'private'
New-Item -ItemType Directory -Force -Path $stage|Out-Null
try{
    Run $gh @('repo','clone',$public,$from,'--','--depth','1','--branch','main')
    Run $gh @('repo','clone',$private,$to,'--','--depth','1','--branch','main')
    $actual=(& $git -C $from rev-parse HEAD|Out-String).Trim()
    $base=(& $git -C $to rev-parse HEAD|Out-String).Trim()
    if($actual -ne $sha -or $base -notmatch '^[a-f0-9]{40}$'){
        throw 'Snapshot waehrend der Freigabe geaendert'
    }
    $ui=@('app-live.js','app.html','app.js','index.html','login.html','login.js',
      'styles.css','portal-language.js','exports.js','assets/blitz-bolt.svg',
      'assets/chargevisor-logo.svg','assets/login-wallbox.webp',
      'assets/lumina-thumb.svg','assets/walectra-logo.webp')
    foreach($file in $ui){
        $a=(& $git -C $from hash-object $file|Out-String).Trim()
        $b=(& $git -C $to hash-object $file|Out-String).Trim()
        if($a -ne $b -or !$a){throw "FRONTEND NICHT IDENTISCH: $file"}
    }
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $branch="release/chargevisor-v1-$stamp"
    $backup="backup/pre-chargevisor-v1-$stamp"
    Run $git @('-C',$to,'branch',$backup,$base)
    Run $git @('-C',$to,'push','origin',$backup)
    Run $git @('-C',$to,'checkout','-b',$branch)
    $tracked=@(& $git -C $from ls-files)
    if($LASTEXITCODE -ne 0){throw 'Quell-Dateien fehlen'}
    $allowedRoot=@('server.mjs','package.json','package-lock.json',
      'requirements-ocpp-simulator.txt','Dockerfile.ocpp-simulator')
    $allowed=@($tracked|Where-Object{
        $_ -match '^(backend/|scripts/|docs/|tools/ocpp-chain-simulator/)' -or
        $allowedRoot -contains $_
    })
    if($allowed.Count -lt 30){throw 'Release-Dateiliste unplausibel'}
    $changed=@()
    foreach($file in $allowed){
        if($file -match '(?i)(^|/)(\.env|secrets|credentials)(\.|/|$)' -or
          $file -match '(?i)\.(pem|p12|pfx|key|sqlite|db)$'){
            throw "Moegliche Geheimnisdatei: $file"
        }
        $src=Join-Path $from $file
        $dest=Join-Path $to $file
        $prior=if(Test-Path -LiteralPath $dest){
            (& $git -C $to hash-object $file|Out-String).Trim()
        }else{''}
        $next=(& $git -C $from hash-object $file|Out-String).Trim()
        if($prior -ne $next){
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force|Out-Null
            Copy-Item -LiteralPath $src -Destination $dest -Force
            $changed+=$file
        }
    }
    $manifest=@{
      sourceRepo=$public;sourceSha=$sha;privateBaseSha=$base;
      backupBranch=$backup;releaseBranch=$branch;changedFiles=$changed
    }|ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $to 'ops-release-manifest.json'),$manifest)
    Push-Location $to
    try{
        Run $node.Source @('scripts/verify-frontend-unchanged.mjs')
        Run $npm.Source @('ci','--ignore-scripts')
        Run $npm.Source @('test')
    }finally{Pop-Location}
    Run $git @('-C',$to,'add','--all')
    Run $git @('-C',$to,'-c','user.name=Walectra Release Preparation',
      '-c','user.email=development@users.noreply.github.com',
      'commit','-m',"Prepare V1 private release candidate $sha")
    Run $git @('-C',$to,'push','-u','origin',$branch)
    $body="Development $sha. Rollback via $backup ($base). Draft only. "+
      'Backup/restore, hardware and deployment acceptance required.'
    Run $gh @('pr','create','--repo',$private,'--base','main',
      '--head',$branch,'--draft','--title','ChargeVisor Business V1 - Controlled Release',
      '--body',$body)
    Write-Host "PRIVATE release PR: $branch" -ForegroundColor Green
    Write-Host "Rollback branch: $backup"
    Write-Host 'Production main / Render unchanged.'
}finally{
    if(Test-Path $stage){
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
