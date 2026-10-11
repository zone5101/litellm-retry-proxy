param(
  [string]$KeyFile = "$env:TEMP\nvkey.tmp",
  [string]$OutDir = 'C:\Users\Z One\.litellm-retry-proxy\limit-probe',
  [int]$PromptChars = 600000,
  [int]$MaxTokens = 64
)
# ctx-probe: do CONTEXT THAT cua model bang cach gui prompt rat lon + max_tokens nho.
# NIM/USE tra 400 voi thong bao "maximum context length is N tokens" -> chinh la max_model_len that.
# Neu chap nhan (stream OK) => context > so token cua prompt.
$ErrorActionPreference = 'Continue'
$k = (Get-Content $KeyFile -Raw).Trim()
$url = 'https://integrate.api.nvidia.com/v1/chat/completions'
if (-not (Test-Path $OutDir)) { [void][IO.Directory]::CreateDirectory($OutDir) }
$filler = 'The quick brown fox jumps over the lazy dog. ' * [Math]::Ceiling($PromptChars / 45)
$filler = $filler.Substring(0, $PromptChars)
$models = @(
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'meta/muse-glimmer-30b',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'poolside/laguna-xs-2.1'
)
$out = Join-Path $OutDir 'ctx-results.jsonl'
foreach ($m in $models) {
  $body = @{ model = $m; messages = @(@{ role = 'user'; content = ($filler + ' Reply with exactly: OK') }); max_tokens = $MaxTokens; stream = $true } | ConvertTo-Json -Depth 5 -Compress
  $bf = Join-Path $OutDir 'ctx-body.json'; $of = Join-Path $OutDir 'ctx-out.ndjson'
  [IO.File]::WriteAllText($bf, $body, (New-Object System.Text.UTF8Encoding($false)))
  if (Test-Path $of) { Remove-Item $of -Force }
  $stat = curl.exe -sS -N --max-time 60 -o $of -w '%{http_code}|%{time_starttransfer}|%{size_download}' -H ("Authorization: Bearer " + $k) -H 'Content-Type: application/json' -d ('@' + $bf) $url 2>$null
  $size = 0; if (Test-Path $of) { $size = (Get-Item $of).Length }
  $content = ''; if ($size -gt 0) { $content = [IO.File]::ReadAllText($of) }
  $ctx = $null
  $mm = [regex]::Match($content, 'maximum context length is (\d+)')
  if ($mm.Success) { $ctx = [int]$mm.Groups[1].Value }
  $mm2 = [regex]::Match($content, 'max_model_len=max_total_tokens=(\d+)')
  if (-not $mm.Success -and $mm2.Success) { $ctx = [int]$mm2.Groups[1].Value }
  $verdict = if ($content.Contains('"choices"')) { 'PROMPT_FIT' } elseif ($ctx) { 'CTX_MEASURED' } else { 'INCONCLUSIVE' }
  $note = if ($ctx) { ('max_model_len=' + $ctx) } elseif ($content.Contains('"choices"')) { ('prompt ' + $PromptChars + ' chars qua duoc') } else { $content.Substring(0, [Math]::Min(200, $content.Length)) }
  $row = [pscustomobject]@{ model = $m; verdict = $verdict; context_length = $ctx; stat = $stat; note = $note; at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
  Add-Content -Path $out -Value ($row | ConvertTo-Json -Compress) -Encoding utf8
  Write-Output ($m.PadRight(48) + ' ' + $verdict.PadRight(15) + ' ' + $note)
}
