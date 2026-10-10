Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Z One\.litellm-retry-proxy"
sh.Run """C:\Program Files\nodejs\node.exe"" ""proxy.js""", 0, False
