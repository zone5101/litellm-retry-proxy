# Silent Retry cho litellm-vscode-chat (Copilot)

**Trang thai hien tai: DANG HOAT DONG bang patch truc tiep vao extension.**

Cach nay khong doi dia chi server, khong dong den API key (SecretStorage), khong anh huong
den chatLanguageModels.json — nen khong gay loi secret/provider-group nhu cach proxy truoc day.

Patch da ap dung cho vivswan.litellm-vscode-chat-0.6.8:
- So lan thu toi da: 5 -> 8
- Backoff: 500ms x2, tran 8s -> 16s (tonrong toi da ~47.5s cho cac window nghen ngan)
- Ap dung cho MOI server/model trong extension (nvidia, ollama-cloud, kimi, gemini, azure...)

## Cac file
- extension.js.backup-0.6.8   : ban goc chua patch (de rollback)
- patch-litellm-retry.ps1     : chay lai sau khi extension duoc update:
                                powershell -ExecutionPolicy Bypass -File patch-litellm-retry.ps1
- proxy.js / config.json      : proxy retry (DA PARK - khong chay). Neu muon dung lai:
                                powershell -File start-proxy.ps1 + doi baseUrl cac server
                                trong settings sang http://127.0.0.1:4010/<tag>
                                (luu y: se gay lai van de secret-binding nhu lan truoc)

## Rollback patch
Copy extension.js.backup-0.6.8 ve lai dist\extension.js cua extension, reload window.