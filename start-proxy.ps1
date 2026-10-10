$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
try { $h = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:4010/__health'; Write-Output ('proxy already running: ' + $h.Content); exit 0 } catch {}
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList ('"' + (Join-Path $dir 'proxy.js') + '"') -WindowStyle Hidden
Start-Sleep -Seconds 2
try { $h2 = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:4010/__health'; Write-Output ('proxy started: ' + $h2.Content) } catch { Write-Output ('proxy start FAILED: ' + $_.Exception.Message) }
