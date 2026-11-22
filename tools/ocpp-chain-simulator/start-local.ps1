# Windows launcher: no Render, Docker or paid hosting required.
# Usage: .\start-local.ps1 -Connectors 6 [-Remote]
param(
    [ValidateRange(1,128)][int]$Connectors = 6,
    [switch]$Remote
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host 'Creating local Python environment...'
    py -3 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3 is required (install from python.org).' }
}
& $python -c 'import ocpp, websockets' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing free open-source dependencies...'
    & $python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not install Python dependencies.' }
}
if (-not $env:CV_SIM_ID) {
    $env:CV_SIM_ID = Read-Host 'OCPP master ID of your TEST station'
}
if (-not $env:CV_SIM_URL) {
    $env:CV_SIM_URL = Read-Host 'Full OCPP websocket URL (ends with /master ID)'
}
if (-not $env:CV_SIM_PASSWORD) {
    $secret = Read-Host 'TEST station OCPP password' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $env:CV_SIM_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}
$argsForSimulator = @('chain_simulator.py', '--connectors', [string]$Connectors)
if ($Remote) { $argsForSimulator += '--remote-test-station' }
& $python @argsForSimulator
exit $LASTEXITCODE
