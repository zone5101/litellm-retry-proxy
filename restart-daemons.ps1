$ErrorActionPreference = 'Continue'
$tc = 'F:\LivingOS_OpenAI_Tunnel\bin\tunnel-client.exe'
$aliases = @('livingos-native','livingos-native-acc03','livingos-native-acc04')

Write-Output '--- STOP (CLI) ---'
foreach ($a in $aliases) {
  $r = & $tc runtimes stop $a --json | ConvertFrom-Json
  Write-Output ("{0}: stopped={1} already_stopped={2}" -f $r.alias, $r.stopped, $r.already_stopped)
}
Start-Sleep -Seconds 1

Write-Output '--- FORCE KILL stale run processes (except acc02) ---'
Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" |
  Where-Object { $_.CommandLine -match ' run ' -and $_.CommandLine -match 'LivingOS-Resident' -and $_.CommandLine -notmatch 'acc02' } |
  ForEach-Object {
    Write-Output "Killing PID $($_.ProcessId) :: $($_.CommandLine)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 2

Write-Output '--- REMAINING run processes ---'
Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" |
  Where-Object { $_.CommandLine -match ' run ' } |
  ForEach-Object { Write-Output "$($_.ProcessId) :: $($_.CommandLine)" }

Write-Output '--- CONNECT x3 ---'
& $tc runtimes connect --alias livingos-native --profile LivingOS-Resident --profile-dir 'F:\LivingOS_OpenAI_Tunnel\profiles' --tunnel-id tunnel_6ab9e80fe3f08191abeb9e6c999ceeaf --runtime-api-key 'file:G:\Black Armor\openai-api-key.txt' --mcp-server-url http://127.0.0.1:17845/mcp --json | ConvertFrom-Json | Select-Object alias, started, already_running, error, runtime_state | ConvertTo-Json -Compress
& $tc runtimes connect --alias livingos-native-acc03 --profile LivingOS-Resident-acc03 --profile-dir 'F:\LivingOS_OpenAI_Tunnel\profiles' --tunnel-id tunnel_6aba04dd1bb081918fc290e46cffd9d5 --runtime-api-key 'file:G:\Black Armor\openai-api-key-acc3.txt' --mcp-server-url http://127.0.0.1:17845/mcp --json | ConvertFrom-Json | Select-Object alias, started, already_running, error, runtime_state | ConvertTo-Json -Compress
& $tc runtimes connect --alias livingos-native-acc04 --profile LivingOS-Resident-acc04 --profile-dir 'F:\LivingOS_OpenAI_Tunnel\profiles' --tunnel-id tunnel_6abc067d552481919992890301ab73c9 --runtime-api-key 'file:G:\Black Armor\openai-api-key-acc4.txt' --mcp-server-url http://127.0.0.1:17845/mcp --json | ConvertFrom-Json | Select-Object alias, started, already_running, error, runtime_state | ConvertTo-Json -Compress

Write-Output '--- NEW run processes ---'
Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" |
  Where-Object { $_.CommandLine -match ' run ' } |
  ForEach-Object { Write-Output "$($_.ProcessId) :: $($_.CommandLine)" }
