param(
  [ValidateSet('github2local', 'local2github')]
  [string]$Direction = 'github2local'
)
# Sync-contract: duy tri 1 nguon su that cho OPERATING CONTRACT v2.
#   github2local : fetch ban moi nhat tu GitHub raw -> cap nhat canonical + toan bo AGENTS.md local
#   local2github : lay phan contract tu AGENTS.md local -> ghi canonical -> commit + push
# Bat ky sua contract o dau: chay script nay (hoac bao Daedalus) la moi ban dong bo.
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\Z One\.litellm-retry-proxy'
$canonical = Join-Path $repo 'OPERATING-CONTRACT.md'
$rawUrl = 'https://raw.githubusercontent.com/zone5101/litellm-retry-proxy/main/OPERATING-CONTRACT.md'
$targets = @(
  'C:\Users\Z One\.freecline\data\workspaces\chat\AGENTS.md',
  'd:\CodexWork\livingos-agent-container-v1\mission-04\copilot-nexus\e2e-workspace\AGENTS.md'
)
$marker = '## MCP tools - use automatically'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$header = '# OPERATING CONTRACT v2 - Reality-First agent operating contract' + "`n`n" + '> Canonical copy for cloud agents. Raw URL: ' + $rawUrl + "`n"

if ($Direction -eq 'local2github') {
  $s = [IO.File]::ReadAllText($targets[0])
  $i = $s.IndexOf($marker)
  if ($i -lt 0) { Write-Output 'LOI: khong thay marker trong AGENTS.md local'; exit 1 }
  $universal = $s.Substring($i)
  [IO.File]::WriteAllText($canonical, $header + "`n" + $universal, $utf8)
  git -C $repo add OPERATING-CONTRACT.md
  $st = git -C $repo status --short -- OPERATING-CONTRACT.md
  if ($st) {
    git -C $repo commit -m 'sync: contract updated from local AGENTS.md' | Out-Null
    git -C $repo push 2>&1 | Out-Null
    Write-Output 'local2github: da commit + push ban moi len GitHub'
  } else {
    Write-Output 'local2github: khong co thay doi gi'
  }
} else {
  $tmp = Join-Path $env:TEMP 'oc_sync.md'
  curl.exe -sSL -o $tmp $rawUrl
  $remote = [IO.File]::ReadAllText($tmp)
  [IO.File]::Delete($tmp)
  if (-not $remote.Contains($marker)) { Write-Output 'LOI: ban tren GitHub khong chua marker (kiem tra push)'; exit 1 }
  $i = $remote.IndexOf($marker)
  $universal = $remote.Substring($i)
  [IO.File]::WriteAllText($canonical, $header + "`n" + $universal, $utf8)
  foreach ($t in $targets) {
    if (-not [IO.File]::Exists($t)) { Write-Output ('BO QUA (khong ton tai): ' + $t); continue }
    $s = [IO.File]::ReadAllText($t)
    $i2 = $s.IndexOf($marker)
    if ($i2 -ge 0) { $s = $s.Substring(0, $i2) + $universal } else { $s = $s + "`n`n" + $universal }
    [IO.File]::WriteAllText($t, $s, $utf8)
    Write-Output ('github2local: da dong bo ' + $t)
  }
  Write-Output 'github2local: xong (canonical + cac AGENTS.md local da dong bo)'
}
