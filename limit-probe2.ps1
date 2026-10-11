param(
  [string]$KeyFile = "$env:TEMP\nvkey.tmp",
  [string]$OutDir = 'C:\Users\Z One\.litellm-retry-proxy\limit-probe',
  [string]$PlanFile = '',
  [int]$FastSec = 25,
  [int]$SlowSec = 80,
  [int]$CapWait = 30,
  [int]$CapRetries = 3
)
# limit-probe v2: do tran max_tokens tung model NVIDIA.
#  - ACCEPT khi stream co byte + "choices" trong FastSec (model thuc su tra loi)
#  - 404 -> NOT_AVAILABLE (model khong dung duoc voi key nay)
#  - ResourceExhausted/429 -> cho CapWait roi thu lai (khong tinh la reject)
#  - 0 byte ca Fast lan Slow -> REJECT (nghi treo/khong chap nhan)
# PlanFile: JSON [{"model":"...","start":262144}] hoac [{"model":"...","cands":[262144,131072]}]
$ErrorActionPreference = 'Continue'
if (-not (Test-Path $KeyFile)) { Write-Output ('LOI: khong thay key file ' + $KeyFile); exit 1 }
$k = (Get-Content $KeyFile -Raw).Trim()
if ($k.Length -lt 20) { Write-Output 'LOI: key qua ngan'; exit 1 }
if (-not (Test-Path $OutDir)) { [void][IO.Directory]::CreateDirectory($OutDir) }
$results = Join-Path $OutDir 'results.jsonl'
$url = 'https://integrate.api.nvidia.com/v1/chat/completions'
$defaultPlan = @(
  [pscustomobject]@{ model = 'z-ai/glm-5.3'; start = 262144 },
  [pscustomobject]@{ model = 'deepseek-ai/deepseek-v4.1-flash'; start = 131072 },
  [pscustomobject]@{ model = 'nvidia/nemotron-3-super-120b-a12b'; start = 131072 },
  [pscustomobject]@{ model = 'nvidia/nemotron-3-ultra-550b-a55b'; start = 131072 },
  [pscustomobject]@{ model = 'nvidia/llama-3.1-nemotron-ultra-253b-v1'; start = 65536 },
  [pscustomobject]@{ model = 'nvidia/nemotron-3.5-lightning-30b-a3b'; start = 65536 },
  [pscustomobject]@{ model = 'meta/muse-glimmer-30b'; start = 65536 },
  [pscustomobject]@{ model = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'; start = 32768 },
  [pscustomobject]@{ model = 'nvidia/ising-calibration-1.5-31b'; start = 32768 },
  [pscustomobject]@{ model = 'poolside/laguna-xs-2.1'; start = 32768 }
)
$plan = $defaultPlan
if ($PlanFile -and (Test-Path $PlanFile)) { $plan = (Get-Content $PlanFile -Raw | ConvertFrom-Json) }
$summary = New-Object System.Collections.ArrayList
foreach ($p in $plan) {
  $ladder = New-Object System.Collections.ArrayList
  if ($p.cands) { foreach ($c in $p.cands) { [void]$ladder.Add([int]$c) } }
  else { $c = [int]$p.start; for ($i = 0; $i -lt 3; $i++) { [void]$ladder.Add($c); $c = [Math]::Max(16384, [int]($c / 2)) } }
  $verdict = 'UNKNOWN'; $accepted_val = $null; $tries = New-Object System.Collections.ArrayList
  foreach ($cand in $ladder) {
    $accepted = $false; $notFound = $false; $note = ''; $stat = ''
    for ($capTry = 0; $capTry -le $CapRetries; $capTry++) {
      $capHit = $false
      foreach ($secs in @($FastSec, $SlowSec)) {
        $bodyFile = Join-Path $OutDir 'body.json'
        $outFile = Join-Path $OutDir 'out.ndjson'
        $esc = '"'
        $body = '{"model":' + $esc + $p.model + $esc + ',"messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":' + $cand + ',"stream":true}'
        [IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path $outFile) { Remove-Item $outFile -Force }
        $stat = curl.exe -sS -N --max-time $secs -o $outFile -w '%{http_code}|%{time_starttransfer}|%{size_download}' -H ("Authorization: Bearer " + $k) -H 'Content-Type: application/json' -d ('@' + $bodyFile) $url 2>$null
        $http = ($stat -split '\|')[0]
        $size = 0; if (Test-Path $outFile) { $size = (Get-Item $outFile).Length }
        $content = ''; if ($size -gt 0) { $content = [IO.File]::ReadAllText($outFile) }
        if ($size -gt 0 -and $content.Contains('"choices"')) { $accepted = $true; $note = ('OK byte=' + $size + ' http=' + $http); break }
        if ($http -eq '404' -or ($size -gt 0 -and $content -match 'not found|Not Found|404')) { $notFound = $true; $note = 'model khong ton tai (404)'; break }
        if ($http -eq '429' -or ($content -match 'ResourceExhausted|Worker local|rate.?limit|overloaded|too many requests')) { $capHit = $true; $note = ('capacity/rate (http=' + $http + ')'); break }
        if ($content -match '"error"\s*:') { $note = ('server error: ' + $content.Substring(0, [Math]::Min(180, $content.Length))); break }
        if ($size -eq 0) { $note = ('0 byte/timeout sau ' + $secs + 's'); continue }
        $note = ('byte=' + $size + ' nhung khong co choices')
      }
      if ($accepted -or $notFound -or -not $capHit) { break }
      if ($capHit -and $capTry -lt $CapRetries) { Write-Output ('    [capacity] cho ' + $CapWait + 's roi thu lai (' + ($capTry + 1) + '/' + $CapRetries + ')'); Start-Sleep -Seconds $CapWait }
    }
    [void]$tries.Add([pscustomobject]@{ max_tokens = $cand; accepted = $accepted; not_found = $notFound; stat = $stat; note = $note })
    Write-Output ('  ' + $p.model + ' @ ' + $cand + ' -> ' + $(if ($accepted) { 'ACCEPT' } elseif ($notFound) { 'NOT_AVAILABLE' } else { 'REJECT' }) + '  [' + $note + ']')
    if ($accepted) { $verdict = 'ACCEPT'; $accepted_val = $cand; break }
    if ($notFound) { $verdict = 'NOT_AVAILABLE'; break }
  }
  if ($verdict -eq 'UNKNOWN') { $verdict = 'REJECTED_ALL' }
  $row = [pscustomobject]@{ model = $p.model; verdict = $verdict; accepted_at = $accepted_val; tries = $tries; at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
  Add-Content -Path $results -Value ($row | ConvertTo-Json -Compress -Depth 6) -Encoding utf8
  [void]$summary.Add($row)
  Write-Output ('==> ' + $p.model + ' : ' + $verdict + ' @ ' + $accepted_val)
}
Write-Output ''
Write-Output '=== TONG KET (limit-probe v2) ==='
$summary | ForEach-Object { Write-Output ($_.model.PadRight(48) + ' ' + $_.verdict.PadRight(22) + ' ' + $_.accepted_at) }
