# Test agent-fast chain: gui 1 request qua router, ghi ket qua + header (model nao serve) ra file temp.
# Chay detached: powershell -File test-agent-fast.ps1 (qua Start-Process, khong bi timeout cua tool goi).
$ErrorActionPreference = 'Continue'
$sta = "$env:TEMP\router-test.sta"
$hdr = "$env:TEMP\router-test.hdr"
$out = "$env:TEMP\router-test.out"
$model = 'agent-fast'
if ($args.Count -gt 0) { $model = $args[0] }
$body = '{"model":"' + $model + '","messages":[{"role":"user","content":"Reply with exactly: ROUTER-OK"}],"max_tokens":500}'
$t0 = Get-Date
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4000/v1/chat/completions' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 420
  $dt = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  Set-Content $sta ('HTTP ' + $r.StatusCode + ' sau ' + $dt + 's [' + $model + ']')
  Set-Content $hdr ('x-litellm-model-id: ' + $r.Headers['x-litellm-model-id'])
  $j = $r.Content | ConvertFrom-Json
  Set-Content $out ('CONTENT: ' + $j.choices[0].message.content + ' | finish_reason: ' + $j.choices[0].finish_reason)
} catch {
  Set-Content $sta ('FAIL sau ' + [math]::Round(((Get-Date) - $t0).TotalSeconds, 1) + 's [' + $model + ']: ' + $_.Exception.Message)
  try { Set-Content $out ('BODY: ' + $_.Exception.Response.ReadToEnd()) } catch {}
}
