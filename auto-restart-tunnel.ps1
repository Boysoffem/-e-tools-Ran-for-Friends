# Powershell script to restart the Node.js server and tunnel every 12 hours
while ($true) {
    Write-Host "[Restart] Stopping any running node server/tunnel..."
    Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'start-tunnel\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    Write-Host "[Restart] Starting node server and tunnel..."
    Start-Process -NoNewWindow -FilePath "node" -ArgumentList "start-tunnel.js" -WorkingDirectory "." 
    Write-Host "[Restart] Node server and tunnel started. Waiting 12 hours..."
    Start-Sleep -Seconds 43200 # 12 hours
}
