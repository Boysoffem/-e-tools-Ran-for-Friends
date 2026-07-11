# PowerShell script to restart server + tunnel every 12 hours.
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

while ($true) {
    Write-Host "[Restart] Stopping any running node server/tunnel processes..."
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq 'node.exe' -and (
                $_.CommandLine -match 'server\.js' -or
                $_.CommandLine -match 'start-tunnel\.js'
            )
        } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }

    Start-Sleep -Seconds 2

    Write-Host "[Restart] Starting server.js..."
    Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $projectDir

    $serverReady = $false
    for ($i = 0; $i -lt 20; $i++) {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:3000/" -UseBasicParsing -Method Head -TimeoutSec 2 | Out-Null
            $serverReady = $true
            break
        } catch {
            Start-Sleep -Seconds 2
        }
    }

    if (-not $serverReady) {
        Write-Warning "[Restart] server.js did not respond on port 3000 within 40s."
    } else {
        Write-Host "[Restart] server.js is healthy on port 3000."
    }

    Write-Host "[Restart] Starting start-tunnel.js..."
    Start-Process -NoNewWindow -FilePath "node" -ArgumentList "start-tunnel.js" -WorkingDirectory $projectDir

    Write-Host "[Restart] Cycle complete. Waiting 12 hours..."
    Start-Sleep -Seconds 43200
}
