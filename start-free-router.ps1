# Free Router - start/health-check daemon LiteLLM port 4000 (127.0.0.1)
# Key: doc tu free-router.env (uu tien) hoac %TEMP%\nvkey.tmp (decrypt-nvkey.ps1 tao).
# Ollama Cloud key: doc truc tiep tu settings.json cua VS Code (server "Ollama Cloud").
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1) Da chay roi thi thoat
try { $h = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:4000/health/liveness'; Write-Output ('free-router already running: HTTP ' + $h.StatusCode); exit 0 } catch {}

# 2) NVIDIA key
$envFile = Join-Path $dir 'free-router.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([A-Z_][A-Z0-9_]*)=(.*)$') { Set-Item -Path ('Env:' + $Matches[1]) -Value $Matches[2].Trim() }
  }
} elseif (Test-Path "$env:TEMP\nvkey.tmp") {
  $env:NVIDIA_API_KEY = (Get-Content "$env:TEMP\nvkey.tmp" -Raw).Trim()
} else {
  Write-Output 'KHONG THAY NVIDIA KEY - chay decrypt-nvkey.ps1 truoc roi thu lai'; exit 1
}

# 3) Ollama Cloud key (tu settings.json)
if (-not $env:OLLAMA_API_KEY) {
  $s = Get-Content "$env:APPDATA\Code\User\settings.json" -Raw
  if ($s -match '"Ollama Cloud"[\s\S]{0,600}?"apiKey"\s*:\s*"([^"]+)"') { $env:OLLAMA_API_KEY = $Matches[1] }
}

# 4) Kiem tra key roi chay daemon (hidden, log vao free-router.log)
if ($env:NVIDIA_API_KEY) { Write-Output ('NVIDIA_API_KEY: ' + $env:NVIDIA_API_KEY.Substring(0,10) + '...') }
if ($env:OLLAMA_API_KEY) { Write-Output ('OLLAMA_API_KEY: ' + $env:OLLAMA_API_KEY.Substring(0,8) + '...') } else { Write-Output 'CANH BAO: thieu OLLAMA_API_KEY - 2 model ollama-cloud se khong dung duoc (chuoi van song voi NIM)' }
if (-not $env:NVIDIA_API_KEY) { Write-Output 'LOI: khong co NVIDIA_API_KEY'; exit 1 }

# Spawn DETACHED: Start-Process truc tiep litellm.exe (KHONG qua cmd /c - cmd lam hong
# quoting khi duong dan chua dau cach, error bay ra console an mat)
$env:PYTHONUTF8 = '1' # Windows: ep Python doc ghi UTF-8, tranh loi cp1252 khi load config/log
$pyExe = (Get-Command python -ErrorAction SilentlyContinue).Source
$litellmExe = Join-Path (Split-Path $pyExe) 'Scripts\litellm.exe'
if (-not (Test-Path $litellmExe)) { Write-Output ('LOI: khong thay ' + $litellmExe); exit 1 }
Start-Process -FilePath $litellmExe -ArgumentList @('--config', 'free-router.config.yaml', '--host', '127.0.0.1', '--port', '4000') -WorkingDirectory $dir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dir 'free-router.log') -RedirectStandardError (Join-Path $dir 'free-router.err.log')
$up = $false
foreach ($i in 1..5) {
  Start-Sleep -Seconds 3
  try { $h2 = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:4000/health/liveness'; if ($h2.StatusCode -eq 200) { $up = $true; break } } catch {}
}
if ($up) {
  Write-Output ('free-router STARTED: HTTP 200 (sau ' + (3 * $i) + ' giay)')
} else {
  Write-Output 'free-router van dang boot (daemon da spawn detached). Kiem tra sau: health/liveness tren port 4000, log: free-router.log + free-router.err.log'
}
