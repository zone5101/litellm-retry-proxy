$existing = Get-NetTCPConnection -LocalPort 19171 -State Listen -ErrorAction SilentlyContinue
if (-not $existing) {
    $pythonw = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\pythonw.exe'
    $bridge = Join-Path $env:LOCALAPPDATA 'AntigravityOpenAIBridge\antigravity_openai_bridge.py'
    if ((Test-Path $pythonw) -and (Test-Path $bridge)) {
        $quotedBridge = '"' + $bridge + '"'
        Start-Process -WindowStyle Hidden -FilePath $pythonw -ArgumentList $quotedBridge
    }
}