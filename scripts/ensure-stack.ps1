$ErrorActionPreference = 'SilentlyContinue'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServerBat = Join-Path $Root 'start-server.bat'
$TunnelBat = Join-Path $Root 'start-ngrok-tunnel.bat'
$LogDir = Join-Path $Root 'logs'
$LogFile = Join-Path $LogDir 'ensure-stack.log'

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-Log {
  param([string]$Message)
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $LogFile -Value ("[$stamp] $Message")
}

function Test-ListeningPort {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

$serverUp = Test-ListeningPort -Port 3000
if (-not $serverUp) {
  Write-Log 'Port 3000 is down; starting server.'
  Start-Process cmd.exe -ArgumentList '/c', "cd /d `"$Root`" && start-server.bat" -WindowStyle Minimized | Out-Null
} else {
  Write-Log 'Port 3000 is healthy.'
}

$tunnelProxyUp = Test-ListeningPort -Port 3001
$tunnelUiUp = Test-ListeningPort -Port 4040
if (-not ($tunnelProxyUp -and $tunnelUiUp)) {
  Write-Log 'Tunnel ports are not healthy; starting ngrok tunnel.'
  Start-Process cmd.exe -ArgumentList '/c', "cd /d `"$Root`" && start-ngrok-tunnel.bat" -WindowStyle Minimized | Out-Null
} else {
  Write-Log 'Tunnel ports 3001 and 4040 are healthy.'
}
