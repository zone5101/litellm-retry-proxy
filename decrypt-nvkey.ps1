param(
  [string]$DbCopy = "$env:TEMP\svc_copy.db"
)
# Lay lai NVIDIA API key tu VS Code SecretStorage:
#  1. master key: %APPDATA%\Code\Local State -> os_crypt.encrypted_key (bo prefix 'DPAPI', DPAPI unprotect)
#  2. giai AES-256-GCM cac blob "v10" trong state.vscdb (xem decrypt-secrets.js)
# Ghi ket qua vao %TEMP%\nvkey.tmp cho limit-probe.ps1 / ceiling-test.ps1 dung.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Security
$ls = Join-Path $env:APPDATA 'Code\Local State'
if (-not (Test-Path $ls)) { Write-Output ('LOI: khong thay ' + $ls); exit 1 }
$j = [IO.File]::ReadAllText($ls) | ConvertFrom-Json
$b64 = $j.os_crypt.encrypted_key
$blob = [Convert]::FromBase64String($b64)
if ([Text.Encoding]::ASCII.GetString($blob, 0, 5) -ne 'DPAPI') { Write-Output 'LOI: blob khong co prefix DPAPI'; exit 1 }
$dp = New-Object byte[] ($blob.Length - 5)
[Array]::Copy($blob, 5, $dp, 0, $dp.Length)
try {
  $keyBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($dp, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
} catch {
  Write-Output ('LOI: DPAPI unprotect that bai - ' + $_.Exception.Message); exit 1
}
Write-Output ('master key OK: ' + $keyBytes.Length + ' byte')
if (-not (Test-Path $DbCopy)) {
  $live = Join-Path $env:APPDATA 'Code\User\globalStorage\state.vscdb'
  Write-Output ('Chua co DB copy, tao tu ' + $live)
  $fs = [IO.File]::Open($live, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  $out = [IO.File]::Create($DbCopy); $fs.CopyTo($out); $out.Close(); $fs.Close()
  Write-Output ('da copy: ' + (Get-Item $DbCopy).Length + ' byte')
}
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Write-Output 'LOI: khong thay node tren PATH'; exit 1 }
$hex = [BitConverter]::ToString($keyBytes).Replace('-', '')
& node (Join-Path $PSScriptRoot 'decrypt-secrets.js') $DbCopy $hex
Write-Output ('exit=' + $LASTEXITCODE)
if (Test-Path "$env:TEMP\nvkey.tmp") { Write-Output ('nvkey.tmp da san sang: ' + (Get-Item "$env:TEMP\nvkey.tmp").Length + ' byte') }
