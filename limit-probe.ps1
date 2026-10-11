param(
  [string]$KeyFile = "$env:TEMP\nvkey.tmp",
  [string]$OutDir = 'C:\Users\Z One\.litellm-retry-proxy\limit-probe',
  [int]$FastSec = 25,
  [int]$SlowSec = 80
)
# Probe tran max_tokens tung model NVIDIA (chap nhan / hang / loi) de set models.parameters dung so.
# Cach do: stream 1 prompt ngan. Co byte + "choices" trong FastSec => ACCEPT (model thuc su chay).
# 0 byte => confirm lai voi SlowSec (phan biet khoi dong cham vs treo that).
$ErrorActionPreference = 'Continue'
if (-not (Test-Path $KeyFile)) { Write-Output ('LOI: khong thay key file ' + $KeyFile + ' - can tao truoc (chi chua key, 1 dong)'); exit 1 }
$k = (Get-Content $KeyFile -Raw).Trim()
if ($k.Length -lt 20) { Write-Output 'LOI: key qua ngan'; exit 1 }
if (-not (Test-Path $OutDir)) { [void][IO.Directory]::CreateDirectory($OutDir) }
$results = Join-Path $OutDir 'results.jsonl'
$url = 'https://integrate.api.nvidia.com/v1/chat/completions'
$plan = @(
  [pscustomobject]@{ model = 'z-ai/glm-5.3';                                    start = 262144 },
  [pscustomobject]@{ model = 'deepseek-ai/deepseek-v4.1-flash';                  start = 131072 },
  [pscustomobject]@{ model = 'nvidia/nemotron-3-super-120b-a12b';                start = 131072 },
  [pscustomobject]@{ model = 'nvidia/nemotron-3-ultra-550b-a55b';                start = 131072 },
  [pscustomobject]@{ model = 'nvidia/llama-3.1-nemotron-ultra-253b-v1';          start = 65536 },
  [pscustomobject]@{ model = 'nvidia/nemotron-3.5-lightning-30b-a3b';            start = 65536 },
  [pscustomobject]@{ model = 'meta/muse-glimmer-30b';                            start = 65536 },
  [pscustomobject]@{ model = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';    start = 32768 },
  [pscustomobject]@{ model = 'nvidia/ising-calibration-1.5-31b';                 start = 32768 },
  [pscustomobject]@{ model = 'poolside/laguna-xs-2.1';                           start = 32768 }
)
$summary = New-Object System.Collections.ArrayList
foreach ($p in $plan) {
  $cand = $p.start
  $verdict = 'UNKNOWN'; $accepted = $null; $tries = New-Object System.Collections.ArrayList
  for ($step = 0; $step -lt 3; $step++) {
    $bodyFile = Join-Path $OutDir ('body.json')
    $outFile = Join-Path $OutDir ('out.ndjson')
    $esc = '"'
    $body = '{"model":' + $esc + $p.model + $esc + ',"messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":' + $cand + ',"stream":true}'
    [IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
    $accepted = $false; $note = ''; $stat = ''
    foreach ($secs in @($FastSec, $SlowSec)) {
      if (Test-Path $outFile) { Remove-Item $outFile -Force }
      $stat = curl.exe -sS -N --max-time $secs -o $outFile -w '%{http_code}|%{time_starttransfer}|%{size_download}|%{exitcode}' -H ("Authorization: Bearer " + $k) -H 'Content-Type: application/json' -d ('@' + $bodyFile) $url 2>$null
      $size = 0
      if (Test-Path $outFile) { $size = (Get-Item $outFile).Length }
      $content = ''
      if ($size -gt 0) { $content = [IO.File]::ReadAllText($outFile) }
      if ($size -gt 0 -and $content.Contains('"choices"')) { $accepted = $true; $note = ('byte=' + $size + ' sec_to_first=' + $secs); break }
      if ($content -match '"error"\s*:') {
        if ($content -match '429|rate') { $note = '429 rate-limit (inconclusive)'; continue }
        $accepted = $false; $note = ('server error: ' + ($content.Substring(0, [Math]::Min(220, $content.Length)))); break
      }
      if ($content -match '404') { $accepted = $false; $note = 'model khong ton tai (404)'; break }
      if ($size -eq 0) { $note = ('0 byte / timeout sau ' + $secs + 's (nghi treo)'); continue }
      $note = ('byte=' + $size + ' nhung khong co choices')
    }
    [void]$tries.Add([pscustomobject]@{ max_tokens = $cand; accepted = $accepted; stat = $stat; note = $note })
    Write-Output ('  ' + $p.model + ' @ ' + $cand + ' -> ' + $(if ($accepted) { 'ACCEPT' } else { 'REJECT' }) + '  [' + $note + ']')
    if ($accepted) { $verdict = 'ACCEPT'; break }
    $cand = [Math]::Max(16384, [int]($cand / 2))
    if ($cand -eq 16384 -and $step -ge 1) { }
  }
  if ($verdict -ne 'ACCEPT') { $verdict = 'NOT_ACCEPTED_IN_LADDER' }
  $row = [pscustomobject]@{ model = $p.model; verdict = $verdict; accepted_at = $(if ($accepted) { $cand } else { $null }); start = $p.start; tries = $tries; at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
  Add-Content -Path $results -Value ($row | ConvertTo-Json -Compress -Depth 6) -Encoding utf8
  [void]$summary.Add($row)
  Write-Output ('==> ' + $p.model + ' : ' + $verdict + ' @ ' + $(if ($accepted) { $cand } else { 'none' }))
}
Write-Output ''
Write-Output '=== TONG KET ==='
$summary | ForEach-Object { Write-Output ($_.model.PadRight(48) + ' ' + $_.verdict.PadRight(24) + ' ' + $_.accepted_at) }
