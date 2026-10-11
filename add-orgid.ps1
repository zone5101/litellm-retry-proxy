# Temporary script: add organization_id to tunnel profiles, then restart daemons
$map = @{
  'LivingOS-Resident'      = 'org-na1UnHrrr5z6PH3wqMcGaVAg'
  'LivingOS-Resident-acc03' = 'org-kcbhRRRddcuaC4RzJO096KKR'
  'LivingOS-Resident-acc04' = 'org-pJssiVmHWLc93PbDsddmNMzR'
}
foreach ($n in $map.Keys) {
  $p = "F:\LivingOS_OpenAI_Tunnel\profiles\$n.yaml"
  $c = Get-Content $p -Raw
  if ($c -notmatch '"organization_id"') {
    # Insert organization_id right after tunnel_id inside control_plane block
    $c = $c -replace '("tunnel_id"\s*:\s*"[^"]+")', "`$1,`r`n    `"organization_id`": `"$($map[$n])`""
    Set-Content -Path $p -Value $c -Encoding UTF8 -NoNewline
  }
  Write-Output "--- $n ---"
  (Get-Content $p -Raw | ConvertFrom-Json).control_plane | ConvertTo-Json
}
