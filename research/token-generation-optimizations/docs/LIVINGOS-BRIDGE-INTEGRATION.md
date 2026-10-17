# Hestia × LivingOS × BRIDGE: ghép tối ưu sinh token vào đúng đường điều khiển

**Kiểm tra:** 2026-10-17. **Phạm vi:** tài liệu tích hợp + bằng chứng đo nhỏ, **chưa patch hay chuyển đổi production runtime**. Không được trình bày nghiên cứu như một triển khai đã được chấp nhận.

## 1. Phân biệt các tuyến hiện hữu

| Tuyến | Vai trò và danh tính | Kiểm chứng |
| --- | --- | --- |
| BRIDGE Brain Controller, loopback `11437` | Controller model theo vai trò (math/review/code), nối Ollama `11436`. Không phải mặc định trỏ đến Hestia 3 GB. | Ngày 17/10 `/health` 200, `PASS_LOCAL_API_CONNECTED`. |
| Hestia managed proxy, `8911` → backend `18911` | Qwen3-4B-Thinking-2507 Hestia-P001 SurgeryChild **Q5_K_M**, GGUF 2,886,758,656 byte; CPU-only. Backend mở khi có request, đóng theo lease. | `/health` 200; trạng thái khi idle: `model_resident=false`. |
| Qwen4B/BRIDGE experimental adapter `11439` | Thử nghiệm Ollama `qwen3:4b` **Q4_K_M**, không phải model Hestia Q5_K_M; từng áp `num_ctx=2048`, `num_predict<=64`. | Ngày 17/10 adapter không live; kết quả cũ bị cắt token. |
| Synthetic standalone port `18913` | Chỉ là runtime sandbox đo tốc độ; không phải route production, Bridge hay một manager thứ hai. | Test 48 token, đã đóng backend sau khi đo. |

**Canonical roles:** [current operator objective](https://github.com/zone5101/LivingOS/blob/main/canonical/handoffs/CURRENT_OBJECTIVE.md) nói Hestia là optional cognition plug-in, không phải universal dispatcher. BRIDGE/model provider không được bypass BAM/lease/Reality hoặc tự suy luận quyền thực thi.

## 2. Điều cần ghép, không thêm một controller khác

```text
Actual authorized LivingOS request / optional BRIDGE role selection
   └─ existing registered model capability, model fingerprint + resource admission
        └─ Hestia managed owner (reuse existing port 8911 / its lease)
             └─ existing llama.cpp/Hestia Q5_K_M backend
                  ├─ exact attention / runtime optimizations (A/B)
                  ├─ n-gram speculative decoding with TARGET verification (A/B)
                  └─ native SSE tokens + cancellation
        └─ Bridge forwards output incrementally; no synthetic/buffered-only streaming
   └─ full request timings, correctness, receipt / independent Reality
```

Integration **is not** exposing `18911` as a competing production process. The currently deployed `hestia_resident_runtime.py` uses `response.read()` before writing the response and forces `Content-Length`; that buffers SSE and hides tokens until complete. Fix at the **existing owner**: forward `text/event-stream` as chunks with flush, retain request lease until generator ends or client cancellation, and release owned backend exactly once on disconnect/exception. Preserve normal nonstream route.

Change Bridge routing only after the actual provider contract registers Hestia as an **explicit optional model**, with same owner, exact model hash, no cross-model fallback and no new daemon/scheduler/global AUTO. Do not globally add network-memory or neural context hooks: the October 17 audit found that optional context augmentation had been intentionally lazy/shadow.

## 3. Eligible optimizations on the *observed* machine

The checked Hestia launcher: `-ngl 0 -t 12 -tb 12 -c 4096 -b 256 -ub 64 -np 1 -ctk q8_0 -ctv q8_0`. 12-core Xeon E5-2678 v3, 24 logical CPUs, two GTX 750 Ti with 2 GB each. Do not assume CUDA Graphs, FlashInfer, tensor cores, Strata MoE expert residency, or multi-GPU quant kernels can run or improve this **CPU dense Qwen**.

- **N-gram speculative with target verification** (`--spec-type ngram-simple`, `--spec-draft-n-max 8`): candidate based on small local throughput test. Sampling distribution-preservation is not yet independently validated for this exact build/config; do not label bitwise equivalent.
- **Flash Attention `auto`**: engine supports it, but on CPU may fall back or regress; test `on/off/auto` separately. Do not attribute observed gain to it without ablation.
- **Thread count + affinity**: A/B physical/SMT CPU placement, original sampling and model unchanged. The earlier `-C 0x555555` baseline alone did **not** speed up.
- **Streaming SSE**: reduces visible wait to first token, not necessarily internal decode tok/s. Must traverse Hestia proxy and Bridge; buffered/synthetic SSE is not real streaming.
- **Prefix/session caching**: only if identical token IDs, positions, tokenizer/model/template, tenant separation and lease lifetime can be proven; request-scoped unload currently prevents persistent KV sharing across independent requests. Never fake prefix reuse by dropping context tokens.
- **Optimizing repeated model load**: compare cold/warm E2E; any keep-warm policy must have resource admission and eviction ownership. Do not force model residency when higher-priority worker owns resources.

**Not eligible as a claimed drop-in:** MoE expert cache for a dense Qwen, CUDA-specific fusion on unsupported GPU, altered weights/precision/KV dtype, context dropping, relaxed speculation, new training, silent switch to `qwen3:4b` Q4_K_M.

## 4. Measurements (17/10/2026; one 48-token sample per configuration; not a product gate)

A same-prompt microtest on Hestia Q5_K_M at 4096 context, 12 CPU threads, CPU-only, sampling temp .6 / top_p .95 / top_k 20, with output capped **ONLY FOR THE BENCHMARK**, found:

| Profile | Measured decode |
| --- | ---: |
| Live managed Hestia proxy baseline | 2.7124 tok/s |
| CPU mask `0x555555`, no speculation | 2.6352 tok/s |
| N-gram speculative without affinity | 3.2172 tok/s |
| N-gram speculative + `0x555555` | 3.3747 tok/s |

The single-run combined result is ~24.4% faster than the single-run live baseline, **not** validated repeatable speedup or Qwen thinking correctness. Model loads, thermal/resource variation and different processes are confounders. Do not extrapolate to long prompts or natural EOS. Sandbox SSE smoke: 16 content events; first content ~4.52 s including a ~3.79 s model startup; **via sandbox directly**, not through current `8911` and BRIDGE.

**Critical fidelity constraint:** existing production `-ctk q8_0 -ctv q8_0` is itself KV precision reduction relative to F16; retaining it unchanged preserves the existing Hestia configuration but is not the same as claiming F16-equivalent KV numerical results. Existing Hestia weight Q5_K_M and head surgery already differ from original F16. Do not change those while assessing runtime improvements.

## 5. Promotion gates / implementation order

1. **Read current canonical owner and Reality first:** never replace production root on the strength of a doc or benchmark alone.
2. **Measure the current Bridge→Hestia pathway, if authorized/registered:** prompt template, native `<think>` continuation until natural EOS, model/quant hash, time to first *actual* token, p50/p95 full wall time, tokens/s, RAM/CPU, cancellation. Do not force `</think>`; separate context exhaustion / user cancellation from natural EOS. Maintain actual context; `n_predict=-1` alone does not create infinite context.
3. **Fix streaming passthrough within existing Hestia proxy owner** in an isolated test first (no second permanent port/manager). Verify SSE non-buffering, UTF-8 reconstruction, disconnect and backend cleanup, nonstream compatibility, lost-client lease closure.
4. **A/B one optimization at a time**, repeated, with fixed prompt dataset and correctness/quality gates: baseline → n-gram only → flash-attn on/off → CPU thread/affinity variants → their proven combination. Use the same backend binary/model hash and hold out prompts.
5. **Explicit opt-in BRIDGE integration:** only registered Hestia provider and existing BAM/lease / Reality. No automatic replacement of other BRIDGE roles or forced Hestia on all questions.
6. **Promote with a rollback-proof receipt** only after native streaming through Bridge, natural-EOS reasoning, cancellation, Vietnamese, code/math and memory/context regressions all pass. Otherwise leave production unchanged.

## Authoritative sources

- [RockMan × Hestia × BRIDGE audit, 2026-10-17](https://github.com/zone5101/LivingOS/blob/main/canonical/checkpoints/ROCKMAN_BRIDGE_COGNITION_MEMORY_READONLY_AUDIT_20261017.md)
- [Current operator role override](https://github.com/zone5101/LivingOS/blob/main/canonical/handoffs/CURRENT_OBJECTIVE.md)
- [LivingOS Inference Quanta — Strata Distillation](https://github.com/zone5101/LivingOS/blob/main/canonical/specs/LIVINGOS_INFERENCE_QUANTA_STRATA_DISTILLATION_V1.md)
- Local 52-line `ROCKMAN_BRIDGE_HANDOFF_20261016.md` and `RUNTIME_AUDIT_VERDICT_20261016.md`, read through **LivingOS Native MCP**, under `F:\LivingOS\ModelLab\BRIDGE_Brain_Ollama\GGUF_GPU_BRIDGE_TRIAL_V1`.
- [Strict fidelity filter](STRICT-FIDELITY.md) and [llama.cpp microbench playbook](LOCAL-LLAMA-CPP.md).

**Status: DOCUMENTATION / MEASUREMENTS ONLY.** No BRIDGE production code changed, no Hestia production launcher changed, no model weight modified, no auto cutover.

## 6. Long-context prefill negative/censored result (2026-10-17)

The operator requested that tests extend beyond the previous 32–48 token microbenchmarks. Through LivingOS Native MCP, an isolated **same Hestia Q5_K_M** backend with **`-c 16384`**, existing **KV q8_0**, CPU-only and **`--no-context-shift`** successfully loaded. The exact server `/tokenize` endpoint measured **9,482 input tokens**, including distinguishable retrieval canaries placed at the start/middle/end. The original generated corpus was **18,177 tokens**, exceeding 16K, and was rejected rather than truncated. A second run used `-b 1024 -ub 512` instead of `-b 256 -ub 64`, without changing model or KV precision.

**Outcome: CENSORED / NOT PASSED.** The 9,482-token full-response test was not completed within the acceptable on-host wall-time window; the test owner explicitly stopped its own long-running child and Windows job. No validated natural-EOS answer, three-canary retrieval verdict, completed TTFT, long-context decode tok/s or speculative A/B quality parity resulted. This is evidence of a serious CPU long-prefill latency bottleneck, **not** evidence of lossless 16K cognition or improved 16K tok/s. One observed earlier `/slots` sample during the baseline showed only 1,536 prompt tokens processed at that instant; do not infer a sustained rate from that single progress snapshot.

Durable local censored report: `F:\LivingOS\ModelLab\BRIDGE_Brain_Ollama\GGUF_GPU_BRIDGE_TRIAL_V1\HESTIA_LONG_CONTEXT_PREFILL_AB_20261017.json`. 16K test backend `18913` was confirmed closed; production BRIDGE `11437` and managed Hestia `8911` remained listening. **No increase of production context from 4096, no optimization promotion, no weight change.** The next measurement design must instrument progressive prefill/first SSE output durably and compare 4K/8K/16K with repeatable resource-admitted workloads; 16/32/64/128K startup-ready tests are not equivalent to quality or throughput tests.
