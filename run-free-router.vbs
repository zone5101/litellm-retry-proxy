' Free Router - chay hidden khi login (Windows)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Z One\.litellm-retry-proxy"
sh.Run """powershell.exe"" -NoProfile -ExecutionPolicy Bypass -File ""start-free-router.ps1""", 0, False
