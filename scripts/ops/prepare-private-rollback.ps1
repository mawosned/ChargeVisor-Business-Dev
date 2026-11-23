# Prepare a PRIVATE rollback PR from the pre-release backup.
# Does not push to production main and NEVER triggers Render deployment.
# The last applied release must have ops-release-manifest.json in private main.
param([string]$ExpectedProductionSha='')
$ErrorActionPreference='Stop'
$repo='mawosned/ChargeVisor-Business'
$ghCmd=Get-Command gh.exe -ErrorAction SilentlyContinue
$gh=if($ghCmd){$ghCmd.Source}else{Join-Path $env:LOCALAPPDATA 'ChargeVisor\tools\gh\bin\gh.exe'}
$gitCmd=Get-Command git.exe -ErrorAction SilentlyContinue
$git=if($gitCmd){$gitCmd.Source}else{Join-Path $env:ProgramFiles 'Git\cmd\git.exe'}
$npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
if(!(Test-Path $gh)-or !(Test-Path $git)-or !$npm){throw 'GitHub CLI, Git and npm required'}
function Run([string]$exe,[string[]]$args){
    & $exe @args
    if($LASTEXITCODE -ne 0){throw "Command failed: $exe $($args[0])"}
}
$stage=Join-Path $env:TEMP ('cv-private-rollback-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force|Out-Null
try{
    $dir=Join-Path $stage 'private'
    Run $gh @('repo','clone',$repo,$dir,'--','--branch','main')
    $main=(& $git -C $dir rev-parse HEAD|Out-String).Trim()
    if($ExpectedProductionSha -and $main -ne $ExpectedProductionSha){
        throw 'Production main differs from approved rollback target'
    }
    $manifestPath=Join-Path $dir 'ops-release-manifest.json'
    if(!(Test-Path -LiteralPath $manifestPath)){
        throw 'No release manifest in production; cannot safely choose rollback'
    }
    $manifest=Get-Content $manifestPath -Raw|ConvertFrom-Json
    if($manifest.backupBranch -notmatch '^backup/pre-chargevisor-v1-[0-9]{8}-[0-9]{6}$' -or
      $manifest.privateBaseSha -notmatch '^[a-f0-9]{40}$' -or
      !$manifest.changedFiles){
        throw 'Invalid or incomplete release manifest'
    }
    Run $git @('-C',$dir,'fetch','origin',$manifest.backupBranch)
    $base=(& $git -C $dir rev-parse ('FETCH_HEAD')|Out-String).Trim()
    if($base -ne $manifest.privateBaseSha){
        throw 'Rollback branch does not match the recorded private baseline'
    }
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $branch="rollback/chargevisor-v1-$stamp"
    Run $git @('-C',$dir,'checkout','-b',$branch)
    foreach($file in $manifest.changedFiles){
        if($file -notmatch '^(backend/|scripts/|docs/|tools/ocpp-chain-simulator/|server[.]mjs$|package[.-]|requirements-ocpp-simulator[.]txt$|Dockerfile[.])'){
            throw "Unexpected rollback file: $file"
        }
        $check=& $git -C $dir cat-file -e ($base+':'+$file) 2>$null
        if($LASTEXITCODE -eq 0){
            Run $git @('-C',$dir,'checkout',$base,'--',$file)
        }else{
            Run $git @('-C',$dir,'rm','-f','--ignore-unmatch','--',$file)
        }
    }
    Run $git @('-C',$dir,'rm','-f','--','ops-release-manifest.json')
    Push-Location $dir
    try{
        Run $npm.Source @('ci','--ignore-scripts')
        Run $npm.Source @('test')
    }finally{Pop-Location}
    Run $git @('-C',$dir,'add','--all')
    Run $git @('-C',$dir,'-c','user.name=Walectra Rollback Preparation',
      '-c','user.email=development@users.noreply.github.com',
      'commit','-m',"Restore private pre-release application baseline $base")
    Run $git @('-C',$dir,'push','-u','origin',$branch)
    $body="Restore source $base from $($manifest.backupBranch). "+
      'Draft ONLY. Merge only after controlled outage investigation. Database is NEVER overwritten.'
    Run $gh @('pr','create','--repo',$repo,'--base','main',
      '--head',$branch,'--draft','--title','ChargeVisor - Controlled Application Rollback',
      '--body',$body)
    Write-Host "PRIVATE rollback PR created: $branch" -ForegroundColor Green
    Write-Host 'Production main / Render and database unchanged.'
}finally{
    if(Test-Path -LiteralPath $stage){
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
