$ErrorActionPreference = 'Stop'
# Re-applies the FULL silent-retry patch set after marketplace updates of litellm-vscode-chat.
# (1) 8 attempts + 16s backoff  (2) retry 429/408/5xx/timeout  (3) effort escalation max->medium->low across retries.
# Run after extension updates: powershell -ExecutionPolicy Bypass -File patch-litellm-retry.ps1
$ext = Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory -Filter 'vivswan.litellm-vscode-chat-*' | Sort-Object Name -Descending | Select-Object -First 1
if (-not $ext) { Write-Output 'khong tim thay extension litellm-vscode-chat'; exit 1 }
$src = Join-Path $ext.FullName 'dist\extension.js'
$s = [IO.File]::ReadAllText($src)
$bt = [char]96
$q = [char]34
$done = $s.Contains('Math.min(8,Math.floor(e.maxAttempts))') -and $s.Contains('e.cause.status===429') -and $s.Contains('globalThis.__lcrm')
if ($done) { Write-Output ('patch DA DAY DU trong ' + $ext.Name + ' - khong can lam gi'); exit 0 }
$reps = @(
  @('Math.max(1,Math.min(5,Math.floor(e.maxAttempts)))', 'Math.max(1,Math.min(8,Math.floor(e.maxAttempts)))'),
  @('maxAttempts:5,maxBufferedParts:16384', 'maxAttempts:8,maxBufferedParts:16384'),
  @('e.wait(Math.min(8e3,500*2**(r-1)))', 'e.wait(Math.min(16000,500*2**(r-1)))'),
  @('async send(e){if(!this.inferenceRecovery(e))return this.sendOnce(e);', 'async send(e){globalThis.__lcrm=0;if(!this.inferenceRecovery(e))return this.sendOnce(e);'),
  @('function Lk(e){if(!A(e))return{};let t=e.reasoningEffort;', 'function Lk(e){if(!A(e))return{};let t=e.reasoningEffort;if(typeof globalThis.__lcrm==' + $bt + 'number' + $bt + '&&globalThis.__lcrm>=2&&typeof t==' + $bt + 'string' + $bt + '&&t!==' + $bt + $bt + '&&t!==bk){t=globalThis.__lcrm===2?' + $bt + 'medium' + $bt + ':' + $bt + 'low' + $bt + '}')
)
$ok = $true
foreach ($r in $reps) {
  $c = [regex]::Matches($s, [regex]::Escape($r[0])).Count
  Write-Output ('target: ' + $c + ' | ' + $r[0].Substring(0, [Math]::Min(46, $r[0].Length)))
  if ($c -ne 1) { $ok = $false }
}
$predOld = 'retryable:e=>e instanceof Y&&e.kind===' + $bt + 'network' + $bt + ','
$predNew = 'retryable:e=>e instanceof Y&&e.kind===' + $bt + 'network' + $bt + '||!!(e&&e.cause&&((e.cause.status!==void 0&&(e.cause.status===429||e.cause.status===408||e.cause.status>=500&&e.cause.status<600))||String(e.cause.name||' + $q + $q + ').indexOf(' + $q + 'Timeout' + $q + ')>=0))' + ','
$cp = [regex]::Matches($s, [regex]::Escape($predOld)).Count
Write-Output ('predicate retry: ' + $cp)
if ($cp -ne 1) { $ok = $false }
$orOld5 = 'onRetry:e=>this.log(' + $bt + 'Network interruption: retrying inference before committing any model output' + $bt + ',{attempt:e,maxAttempts:5})'
$orOld8 = $orOld5.Replace('maxAttempts:5', 'maxAttempts:8')
$orNew = 'onRetry:e=>(globalThis.__lcrm=Math.min(e+1,3),this.log(' + $bt + 'Network interruption: retrying inference before committing any model output' + $bt + ',{attempt:e,maxAttempts:8}))'
$c5 = [regex]::Matches($s, [regex]::Escape($orOld5)).Count
$c8 = [regex]::Matches($s, [regex]::Escape($orOld8)).Count
Write-Output ('onRetry (5/8): ' + $c5 + '/' + $c8)
if ($c5 -ne 1 -and $c8 -ne 1) { $ok = $false }
if (-not $ok) { Write-Output 'Cau truc file da thay doi - KHONG patch tu dong, kiem tra tay.'; exit 1 }
Copy-Item $src ($src + '.backup-before-retrypatch') -Force
foreach ($r in $reps) { $s = $s.Replace($r[0], $r[1]) }
$s = $s.Replace($predOld, $predNew)
if ($c5 -eq 1) { $s = $s.Replace($orOld5, $orNew) } else { $s = $s.Replace($orOld8, $orNew) }
[IO.File]::WriteAllText($src, $s, (New-Object System.Text.UTF8Encoding($false)))
node --check $src
if ($LASTEXITCODE -eq 0) { Write-Output ('PATCH DAY DU OK cho ' + $ext.Name + ' - reload window de ap dung') }
else { Write-Output 'SYNTAX ERROR - phuc hoi tu backup'; Copy-Item ($src + '.backup-before-retrypatch') $src -Force }