$k = (Get-Content "$env:TEMP\nvkey.tmp" -Raw).Trim()
$body = '{"model":"z-ai/glm-5.3-flash","messages":[{"role":"user","content":"Think at MAXIMUM depth and length. Exhaustively analyze the design of a distributed consensus system: enumerate every failure mode, every tradeoff, verify every argument, explore alternatives, and only produce the final answer after the most thorough reasoning you are capable of."}],"max_tokens":262144,"stream":true}'
[IO.File]::WriteAllText("$env:TEMP\body_ceiling.json", $body)
$log = 'C:\Users\Z One\.litellm-retry-proxy\ceiling-test.log'
Write-Output ("START " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Out-File $log -Encoding utf8
curl.exe -sS -N -H "Authorization: Bearer $k" -H "Content-Type: application/json" -d "@$env:TEMP\body_ceiling.json" https://integrate.api.nvidia.com/v1/chat/completions 2>&1 | Out-File $log -Append -Encoding utf8
Write-Output ("END " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Out-File $log -Append -Encoding utf8