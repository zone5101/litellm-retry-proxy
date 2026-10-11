param(
  [string]$Settings = "$env:APPDATA\Code\User\settings.json",
  [switch]$DryRun
)
# apply-limits: ghi gioi han max_tokens (models.parameters) + capabilities that cho NVIDIA server.
# So lieu lay tu limit-probe/ctx-probe (do bang chinh server NVIDIA tra loi), xem MAINTENANCE.md muc 10.
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Settings.backup-limits-$stamp"
Copy-Item $Settings $backup -Force
Write-Output ('backup -> ' + $backup)

# --- du lieu quyet dinh: model => [context_length, max_input_tokens, max_output_tokens, max_tokens(gui di)] ---
$plan = @(
  @{ model = 'z-ai/glm-5.3';                                  ctx = 1048576; min = 1044480; mout = 262144; mt = 262144 },
  @{ model = 'z-ai/glm-5.3-flash';                            ctx = 1048576; min = 1044480; mout = 262144; mt = 262144 },
  @{ model = 'deepseek-ai/deepseek-v4.1-flash';               ctx = 1048576; min = 1044480; mout = 262144; mt = 262144 },
  @{ model = 'nvidia/nemotron-3-super-120b-a12b';             ctx = 262144;  min = 131072;  mout = 131072; mt = 131072 },
  @{ model = 'nvidia/nemotron-3-ultra-550b-a55b';             ctx = 262144;  min = 131072;  mout = 131072; mt = 131072 },
  @{ model = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'; ctx = 262144;  min = 131072;  mout = 131072; mt = 131072 },
  @{ model = 'nvidia/nemotron-3.5-lightning-30b-a3b';         ctx = 262144;  min = 131072;  mout = 131072; mt = 131072 },
  @{ model = 'meta/muse-glimmer-30b';                         ctx = 262144;  min = 131072;  mout = 131072; mt = 131072 },
  @{ model = 'poolside/laguna-xs-2.1';                        ctx = 262144;  min = 131072;  mout = 131072; mt = 131072 },
  @{ model = 'nvidia/ising-calibration-1.5-31b';              ctx = 131072;  min = 65536;   mout = 65536;  mt = 65536 }
)

$j = [IO.File]::ReadAllText($Settings) | ConvertFrom-Json
$params = $j.PSObject.Properties['litellm-vscode-chat.models.parameters'].Value
if (-not $params) { throw 'khong thay litellm-vscode-chat.models.parameters' }
$servers = $j.PSObject.Properties['litellm-vscode-chat.servers'].Value
$srv = $servers | Where-Object { $_.label -eq 'NVIDIA LiteLLM' }
if (-not $srv) { throw 'khong thay server NVIDIA LiteLLM' }
if (-not $srv.models) { $srv | Add-Member -NotePropertyName models -NotePropertyValue ([pscustomobject]@{}) -Force }
if (-not $srv.models.capabilities) { $srv.models | Add-Member -NotePropertyName capabilities -NotePropertyValue ([pscustomobject]@{}) -Force }
$caps = $srv.models.capabilities

foreach ($p in $plan) {
  # 1. models.parameters -> max_tokens gui trong request
  $val = [pscustomobject]@{ max_tokens = [int]$p.mt }
  if ($params.PSObject.Properties[$p.model]) { $params.PSObject.Properties[$p.model].Value = $val }
  else { $params | Add-Member -NotePropertyName $p.model -NotePropertyValue $val -Force }
  # 2. capabilities -> context/input/output that
  $cap = [pscustomobject]@{ context_length = [int]$p.ctx; max_input_tokens = [int]$p.min; max_output_tokens = [int]$p.mout }
  if ($caps.PSObject.Properties[$p.model]) { $caps.PSObject.Properties[$p.model].Value = $cap }
  else { $caps | Add-Member -NotePropertyName $p.model -NotePropertyValue $cap -Force }
  Write-Output ('  set ' + $p.model.PadRight(48) + ' max_tokens=' + $p.mt + ' ctx=' + $p.ctx + ' in=' + $p.min + ' out=' + $p.mout)
}

$json = $j | ConvertTo-Json -Depth 30
if ($DryRun) { Write-Output 'DRY RUN - khong ghi file'; Write-Output $json.Substring(0, [Math]::Min(400, $json.Length)); exit 0 }
[IO.File]::WriteAllText($Settings, $json, (New-Object System.Text.UTF8Encoding($false)))

# --- verify bang doc lai (khong tin vao tri nho) ---
$chk = [IO.File]::ReadAllText($Settings) | ConvertFrom-Json
$p2 = $chk.PSObject.Properties['litellm-vscode-chat.models.parameters'].Value
$c2 = ($chk.PSObject.Properties['litellm-vscode-chat.servers'].Value | Where-Object { $_.label -eq 'NVIDIA LiteLLM' }).models.capabilities
Write-Output ''
Write-Output '=== VERIFY (doc lai tu file) ==='
foreach ($p in $plan) {
  $gotMt = $p2.PSObject.Properties[$p.model].Value.max_tokens
  $gotCtx = $c2.PSObject.Properties[$p.model].Value.context_length
  $ok = ($gotMt -eq $p.mt) -and ($gotCtx -eq $p.ctx)
  Write-Output ('  ' + $(if ($ok) { 'OK  ' } else { 'FAIL' }) + $p.model.PadRight(48) + ' mt=' + $gotMt + ' ctx=' + $gotCtx)
}
Write-Output ('tong entry parameters: ' + @($p2.PSObject.Properties | Where-Object { $_.Name -ne 'livePreview' }).Count)
