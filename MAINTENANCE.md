# MAINTENANCE - Silent Retry System cho litellm-vscode-chat (Copilot Chat)

> Checkpoint 2026-10-11, viet boi Daedalus (AI agent). Muc dich: lan sau bao tri (ban hoac AI khac)
> doc file nay la hieu toan bo - viec sao, da sua gi o dau, vi sao, rollback the nao - khong phai
> chan doan lai tu dau. Viet khong dau de tranh loi encoding.

## 1. Tinh nang la gi

Copilot Chat dung extension vivswan.litellm-vscode-chat de nap model tu server tu cau hinh
(NVIDIA integrate API, Ollama Cloud, Kimi, Gemini, Azure). Endpoint free cua NVIDIA co 3 tang loi
làm request chet giua duong -> Copilot hien "Sorry, no response was returned". He thong nay
tu chua: retry 8 lan (backoff toi 16s) + leo thang effort (max->medium->low) + budget output lon.

## 2. 3 tang loi DA CHUNG MINH bang thu nghiem (dung chan doan lai)

| Tang | Hien tuong | Bang cuoc |
|---|---|---|
| (a) Het output budget (think + answer dung chung 1 quay) | finish_reason=length, 0 content | max_tokens=64 va =1024 deu chi co reasoning, content rong |
| (b) Tuong ~6 phut cua gateway | cat ngang stream, KHONG finish_reason, khong [DONE] | test 373s, cat giua tu ("...N"), ~9.4k thinking tokens, stream van chay deu |
| (c) 429/5xx/timeout + ECONNRESET | loi transport | 16/16 GET ok nhung agentic storm dinh 429; session co 73 lan nhac 429 |

Luu y: mang nha KHONG phai van de (16/16 GET ok, 10MB download 6MB/s, idle TLS song 30s+).
Tran max_tokens: server chap nhan den 262144 (256k); 524288 BI TREO (0 byte in 20s).

## 3. Ban do thay doi

### 3.1 extension.js (vivswan.litellm-vscode-chat-0.6.8\dist\extension.js) - 7 diem va
Patch TRUC TIEP file minified. Nguon su that: patch-litellm-retry.ps1 (chua old->new day du).
1. maxAttempts 5->8: Math.max(1,Math.min(5,... -> Math.min(8,...
2. backoff cap 8s->16s: e.wait(Math.min(8e3,500*2**(r-1))) -> Math.min(16000,...)
3. cosmetics: maxAttempts:5,maxBufferedParts:16384 -> maxAttempts:8,...
4. (patch-2) retryable predicate: truoc chi nhan kind 'network'; sau them 429/408/5xx qua
   e.cause.status va Timeout qua ten loi. Y: 429/timeout truoc day KHONG duoc retry.
5. (patch-3) send(): chen globalThis.__lcrm=0 truoc await hz - reset moi request
6. (patch-3) onRetry: onRetry:e=>(globalThis.__lcrm=Math.min(e+1,3),...) - attempt fail thu N
   dat level N+1 (cap 3)
7. (patch-3) Lk(): Lk la diem chuyen reasoningEffort -> reasoning_effort cho body API;
   neu __lcrm>=2 thi ha: level 2 -> 'medium', level 3+ -> 'low'
File co comment marker o CUOI file danh dau patch set v1 + duong dan doc nay.

### 3.2 settings.json (%APPDATA%\Code\User\settings.json)
- litellm-vscode-chat.models.parameters: { "z-ai/glm-5.3-flash": { "max_tokens": 262144 } }
- capabilities max_output_tokens glm-5.3-flash: 262144 (tu 4096)
- litellm-vscode-chat.chat.timeout: 1800000 (30 phut - tranh extension tu huy request nghi lau)
- Backups canh settings.json: .backup-litellm-proxy (truoc thu proxy), .backup-parameters (truoc block parameters)

### 3.3 Thu muc nay (.litellm-retry-proxy)
- proxy.js + config.json + start-proxy.ps1 + run-hidden.vbs: local retry proxy - DA PARK
  (khong chay, khong auto-start) vi doi baseUrl gay xung dot secret-binding cua extension
  (key gan theo dia chi server). Chi bat lai neu thuc su hieu dieu do.
- patch-litellm-retry.ps1: re-apply TOAN BO patch sau khi vivswan update extension
  (tu do version moi nhat, tu backup, tu rollback neu syntax loi, tu choi neu cau truc doi)
- ceiling-test.ps1 / ceiling-test.log: bai test tran (ket qua o muc 2)
- extension.js.backup-0.6.8: ban goc chua va cua vivswan 0.6.8

## 4. Co che leo thang (patch-3) - giai thich magic
- send() reset __lcrm=0 moi request -> moi request moi luon bat dau effort goc (xhigh)
- hz goi onRetry(r) khi attempt thu r FAIL -> dat __lcrm=r+1 (cap 3)
- Lk() doc __lcrm: >=2 thi ha effort. bk = sentinel 'default' cua extension;
  dieu kien t!==bk tranh gui 'default' len API
- Y: khong ha o lan 1 (chu nhan muon xem max); chi ha khi tuong cat that

## 5. Bang chan doan nhanh
| Hien tuong | Chan doan | Hanh dong |
|---|---|---|
| Sorry,no response nhung bam retry la duoc | ca 8 lan thu chet (NVIDIA khan cap dai) | kiem tra 429/status NVIDIA; doi model tam |
| Response chi co reasoning, khong dap an, lap lai | het budget 262k (hiem - tuong 6 phut can truoc) | tang max_tokens trong models.parameters |
| Server do "secret... different server address" | ai do doi baseUrl | khoi phuc baseUrl cu hoac re-enter key |
| Sau khi vivswan update, loi tro lai | marketplace ghi de file da va | chay patch-litellm-retry.ps1 |
| Ket noi bi cat dung luc 6 phut | tuong gateway (muc 2b) | binh thuong - retry da lo; neu gap nhieu ha effort |

## 6. Rollback tung lop
- Chi rollback patch: copy dist\extension.js.backup-before-retrypatch -> dist\extension.js, reload window
- Ve ban goc 0.6.8: extension.js.backup-0.6.8
- Rollback settings: cac file .backup-* canh settings.json
- Marker cuoi extension.js xac nhan file da duoc va (patch set v1)

## 7. Gioi han da biet (khong dua 100%)
- Tuong ~6 phut la server-side - client khong xoa duoc; effort max van co the chet o lan 1
- Khong phu model built-in cua Copilot (GPT qua GitHub)
- NVIDIA sap dai/ca dem van co the fail - xac suat thap voi 8 lan leo thang
- Bundle moi cua vivswan co the doi cau truc -> script tu choi va -> phai tim lai vi tri
  (pattern tim: 'maxAttempts', 'retryable:e=>', 'function Lk', 'onRetry:e=>', 'maxBufferedParts')

## 8. Lich su git (repo local nay)
- ce564e4: tooling ban dau (proxy, patch script, ceiling test, README)
- commit sau: MAINTENANCE.md (file nay) + marker v1 trong extension.js
## 9. Sync-contract script (2026-10-11)
- sync-contract.ps1: duy tri 1 nguon su that cho OPERATING CONTRACT v2
- Usage: powershell -File sync-contract.ps1 -Direction github2local (hoac local2github)
- github2local: fetch raw GitHub (public, khong auth) -> canonical + AGENTS.md local
  (Daedalus chat workspace + Codex e2e-workspace)
- local2github: doc AGENTS.md local -> canonical -> commit + push (neu co thay doi thuc su)
- Sua contract o dau cung duoc; chay 1 chieu la moi ban khop. Canonical public URL:
  https://raw.githubusercontent.com/zone5101/litellm-retry-proxy/main/OPERATING-CONTRACT.md
- Repo da PUBLIC (2026-10-11) de cloud agent doc raw URL khong can token.

## 10. Gioi han output tung model NVIDIA - DO THAT (2026-10-11)

Van de: extension chi gui max_tokens = min(4096, maxOutputTokens) khi model KHONG co record
models.parameters (nguon `capped` trong AE()). Truoc day chi z-ai/glm-5.3-flash co record 262144
-> 10 model con lai chay 4096 token -> think an het budget -> "Sorry, no response was returned".
Catalog OpenRouter (openrouter-models.json, 467 record) chi giup HIEN THI context, KHONG nang budget.

Cong cu do (moi, trong thu muc nay):
- decrypt-nvkey.ps1 + decrypt-secrets.js: lay lai NVIDIA key tu VS Code SecretStorage
  (master key = os_crypt.encrypted_key trong %APPDATA%\Code\Local State -> bo prefix DPAPI ->
  DPAPI unprotect; roi AES-256-GCM cho cac blob "v10" trong state.vscdb). Ket qua -> %TEMP%\nvkey.tmp.
- limit-probe.ps1 / limit-probe2.ps1: do tran max_tokens (ACCEPT = stream co byte + "choices";
  404 -> NOT_AVAILABLE; ResourceExhausted/429 -> cho 30s thu lai, khong tinh la reject).
- ctx-probe.ps1: do context that bang prompt 600k ky tu (NIM tra 400 "maximum context length is N").
- apply-limits.ps1: ghi settings.json (tu backup + verify bang doc lai).

Ket qua (bang cuoc: limit-probe/results-round1..4.jsonl, ctx-results.jsonl):
| model | max_tokens set | bang chung tu server |
|---|---|---|
| z-ai/glm-5.3 | 262144 | accept 262144 (byte+choices+finish_reason+DONE) |
| z-ai/glm-5.3-flash | 262144 | nhu tren (da co tu phien truoc) |
| deepseek-ai/deepseek-v4.1-flash | 262144 | accept 262144 |
| nvidia/nemotron-3-super-120b-a12b | 131072 | accept 262144; prompt 150k token qua duoc |
| nvidia/nemotron-3-ultra-550b-a55b | 131072 | nhu tren |
| nvidia/nemotron-3-nano-omni-30b-a3b-reasoning | 131072 | accept 262144 (round1 32768 reject = loi tam thoi) |
| nvidia/nemotron-3.5-lightning-30b-a3b | 131072 | round1 treo/404 tam thoi; accept 16384 -> 131072 -> 262144 |
| meta/muse-glimmer-30b | 131072 | accept 262144 nhung prompt 150k -> 500 Internal server error |
| poolside/laguna-xs-2.1 | 131072 | accept 131072; 262144 -> ResourceExhausted (capacity) |
| nvidia/ising-calibration-1.5-31b | 65536 | server khai ctx tong = 131072; 131072 -> 400 |
| nvidia/llama-3.1-nemotron-ultra-253b-v1 | khong set | 404 moi lan - khong dung duoc voi key nay |

Vi sao 131072 (khong 262144) cho nhom ctx 262144: output + input dung chung context. Khai
ctx=262144 + max_tokens=262144 => max_input = 0 => extension chan moi cuoc chat. 131072 de lai
131072 cho prompt - ca hai deu da duoc chung minh chap nhan.

Loss & lessons:
- Catalog OpenRouter KHONG dung lam nguon gioi han: nemotron-super khai maxout 16384 nhung server
  nhan 262144; muse khai ctx 131072 nhung nhan output 262144. Chi tin loi server tra ve.
- Khi nang max_tokens BAT BUOC khai capabilities: extension co
  `if (prompt+tool > maxInputTokens) throw "conversation looks too long for the model"`, va
  maxInputTokens = max(1, ctx - maxOut). Chi nang output ma khong khai ctx => maxInput = 1 => chan het.
- "capacity/rate" va "0 byte/timeout" phai coi la CHUA KET LUAN, khong phai reject (round1 ket luan
  sai 3 ca: nano-omni, lightning, laguna - round2 deu ACCEPT).

Trang thai cuoi: settings.json co 11 entry models.parameters + 10 record capabilities cho server
NVIDIA LiteLLM (backup: settings.json.backup-limits-<stamp>). PHAI Reload Window de extension doc lai.
Entry nvidia/llama-3.1-nemotron-ultra-253b-v1 (max_tokens=16000) do user tao tu truoc - giu nguyen.
Kiem chung phia extension: hoi Copilot `litellm_inspect_model` cho tung model de xem max tokens hieu luc.

## 11. Antigravity Local provider bridge (2026-10-12)

Muc tieu: dung model dang duoc account Antigravity desktop hop le expose nhu model BYOK/native provider trong VS Code/Copilot/Daedalus, chon dung model ID, khong auto-route va khong fallback sang model khac. MCP khong nam tren duong model transport.

Kien truc da chung minh:
- Antigravity Electron spawn `resources/bin/language_server.exe`.
- Language server tu mo loopback HTTPS port dong va expose Connect RPC.
- Bridge `antigravity/antigravity_openai_bridge.py` tu rediscover port hien tai, doc CSRF boot value vao RAM, goi `GetAvailableModels` va `GetModelResponse`, roi expose localhost OpenAI-compatible `:19171/v1`.
- VS Code `vivswan.litellm-vscode-chat` da discover catalog nay va cac model Antigravity da xuat hien trong model registry, ke ca Agent Host cua Copilot.
- Khong persist OAuth/session/CSRF; khong patch binary Antigravity; unknown model fail closed.

Tool ownership rootfix:
- Lan test `vscode.lm` dau tien voi `LanguageModelChatToolMode.Required`, model bam dung example trong prompt va boc protocol duoi key `tool_call`; bridge cu coi no la text.
- Fix: chi unwrap hai presentation wrapper da biet (`tool_call` / `final`), sau do van validate protocol noi; tool name phai nam trong danh sach harness da advertise va arguments phai la JSON object. Tool khong duoc model/bridge tu thuc thi.
- Backup truoc fix: `antigravity_openai_bridge.py.pre_toolfix_20261012`.
- SHA-256 backup: `44ce2ec901f264121754e5ffd1c4215846d6eb1d27e5e841f5600e6a59c7ac39`.
- SHA-256 bridge hien tai: `e1d18dcc04ebb7ab4ca0cb4fea15c3ee211f6f485a317eade63104d036b17021`.

Acceptance:
- `GetModelResponse` explicit-model canary PASS.
- Real VS Code 1.141 `vscode.lm` text request qua provider PASS.
- Real VS Code tool loop PASS: model `gemini-3.5-flash-lite` -> `LanguageModelToolCallPart(lookup_magic_number)` -> harness tra `LanguageModelToolResultPart("314159")` -> model final `The authoritative magic number is 314159.`.
- Mot candidate run gap upstream Cloud Code TCP/HTTP 500 truoc inference; khong co tool/side effect. Chi mot fresh retry duoc dung va PASS, khong them retry loop.
- SSE hien tai la OpenAI compatibility framing sau unary inference, KHONG phai backend token-by-token streaming.

Runtime:
- Local install: `%LOCALAPPDATA%\AntigravityOpenAIBridge\`.
- Startup: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AntigravityOpenAIBridge.cmd`.
- Listener: `127.0.0.1:19171`.
- VS Code provider base URL: `http://127.0.0.1:19171/v1`.

Rollback:
1. Stop bridge listener owner on 19171.
2. Restore `antigravity_openai_bridge.py.pre_toolfix_20261012` over the live bridge.
3. Run `start_bridge.ps1`.
4. Verify `/health`, `/v1/models`, then one bounded provider canary.
5. Do not touch Antigravity credentials or packaged binary.

Git:
- bridge source: `2e99e4c3e69b4151a527787e0357904f3e195871`
- launcher: `ae16da416f027417e056292940918ca7f8b0010c`
- bridge docs: `dce566b395084fa920af8deace6a2beece5ef338`

Loss & lesson:
- Descriptor presence khong dong nghia local handler: `ApiServerService.GetChatMessage` co schema dep nhung khong co exact local route string; khong blind-retry.
- Tool schema co the dung nhung model-facing example van lam model boc them presentation wrapper. Parser phai chap nhan representation repair co gioi han, sau do fail-closed tren tool authority.
- External harness phai giu quyen execute tool; provider bridge chi chuyen doi model request/response.
