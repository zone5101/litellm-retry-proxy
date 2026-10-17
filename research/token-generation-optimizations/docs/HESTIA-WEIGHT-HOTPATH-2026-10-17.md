# Hestia SurgeryChild — exact-weight inference hot path, GPU-placement and NUMA evidence

**Status: RESEARCH / NO RUNTIME PROMOTION / NO NEW MODEL.** Measured 2026-10-17 using existing LivingOS Native MCP and bounded sandbox processes owned by `local_workload_guard(QWEN_BRIDGE)`. Not approval to alter deployed Hestia, BRIDGE roles, BAM or model weights.

## Exact model identity and weight anatomy

Live manifest: `G:\LivingOS\_ACTIVE_WORK_20260905\_RockMan\config\hestia_model_identity_current.json`.

- `Qwen3-4B-Thinking-2507.Hestia-P001.SurgeryChild-QHead10Sext.Q5_K_M.gguf` — SHA-256 `4cf2067b66bfed33c897a5528de068522f5633e743c6477691cb2835a8d07a9d`.
- **2,886,758,656 bytes, GGUF v3, 398 tensors, 36 dense Qwen3 blocks**. Model header advertises 262,144 context tokens; production Hestia **actually uses `-c 4096`**.
- For 35 blocks FFN width is 9,728. The surgically changed **block 34 has FFN width 8,320**, with `ffn_gate/up` Q5_K and **`ffn_down` Q8_0**; all three must be handled by the modified loader.
- Tensor storage computed by parsing GGUF header and adjacent tensor offsets (includes alignment and may differ slightly from executable bytes read; **NOT a sampled kernel-time profile**):

| Group / repeated dense operator | Bytes in GGUF (MiB) | % of full file | Meaning |
| --- | ---: | ---: | --- |
| FFN down | 646.69 | 23.49% | Return expanded hidden state to residual width |
| FFN gate | 585.45 | 21.27% | Gate path of SwiGLU FFN |
| FFN up | 585.45 | 21.27% | Value/expansion path of SwiGLU FFN |
| Attention Q + attention output | 495.00 | 17.98% | Query projection / attention output projection |
| Token embedding | 304.28 | 11.05% | Input table, and probable tied output logits weight because no `output.weight` tensor |
| Attention K + V | 129.73 | 4.71% | K/V projections; separate from the growing KV cache |

**First kernel hypothesis:** The three FFN matrices together are **1,817.59 MiB (~66.03% file)** and are executed for every generated token in a **dense** model. They therefore deserve the first **measured** CPU matrix-vector profile. This is not proof that they account for 66% of execution time: different quant types, kernels, caches, output-logit projection, attention at long contexts and memory placement matter.

The exact ggml CPU x86 source in the existing compatible Hestia lineage is:
`D:\LivingOS_lab\qwen3_20260908\sandbox\src\qvac_loader_ffn_v1_server_b10964\ggml\src\ggml-cpu\arch\x86\quants.c`.

- `ggml_vec_dot_q5_K_q8_K` at approximately line **2224**.
- `ggml_vec_dot_q6_K_q8_K` at approximately line **2434**.
- `ggml_vec_dot_q8_0_q8_0` at approximately line **1308**.

Instrument `GGML_OP_MUL_MAT` by tensor identity in a **sibling build** before optimizing a specific kernel; otherwise this is ranking by bytes only. Native MSVC build `GGML_NATIVE=ON` runs `FindSIMD.cmake`; CMake recorded `AVX2_FOUND=TRUE`, `FMA_FOUND=TRUE`. Do **not** claim lack of AVX2/FMA without disassembly or actual instruction-path measurement.

## Exact-model selective weight placement A/B on available two GTX 750 Ti

The usual installed Ollama CUDA model loader **cannot load** this surgery GGUF; it rejects `blk.34.ffn_gate.weight` as 8,320 instead of expected 9,728. Therefore previous `qwen3:4b` Q4_K_M GPU benchmarks **cannot be treated as this Hestia's weight-specific performance**.

An existing **Hestia custom CUDA sibling** is compatible:
`D:\LivingOS_lab\qwen3_20260908\sandbox\build_hestia_server_custom_cuda_v4_ninja\bin\llama-server.exe`.
It initially exited `0xC0000135` due to missing runtime DLL in its ordinary process search path. **Per-child environment only**, prepend installed Ollama `cuda_v12` DLL directory; both CUDA0/CUDA1 then pass `--list-devices`. This changes neither global PATH nor installed software.

Keep `-ctk q8_0 -ctv q8_0` and use `-fa auto`: `-fa off` causes **quantized V cache requires flash_attn** and is not a valid A/B configuration. CPU-only and GPU variants use the same custom CUDA binary, prompt, temperature 0 / seed and 64 generated tokens (benchmark ceiling only), context 4096, no KV offload.

| Profile (all same surgery model and custom CUDA binary) | Decode tok/s | GPU weight allocation | Verdict |
| --- | ---: | --- | --- |
| CPU weights; no GPU layer | **4.116** | CUDA ~28–29 MiB each for runtime | Accepted baseline, **one sample** |
| Override `token_embd\.weight=CUDA0` only | **2.276** | CUDA0 +369 MiB | **REGRESSION**; reject output/head-only placement |
| Last 12 complete transformer blocks, `-ngl 12`, split between both GPUs | **3.453** | CUDA0 +462 MiB, CUDA1 +694 MiB | **REGRESSION**; reject this split |

Sampled output hashes differ across CPU/GPU greedy runs, so output/quality parity **not demonstrated**. The GPU trials successfully ran inference and released model resources; this is not a reliability or long-context acceptance.

Existing alternative dedicated **CPU** `Hestia.exe` has reached ~6–7.24 tok/s on short prompts under selected thread/NUMA trials. **Do not compare different executable builds as if a strict matched A/B**. The 2026-10-16 separate Q4_K_M/Ollama 10.38 tok/s baseline and dual GPU 8.53 tok/s used **different GGUF**, and do not establish an advantage for SurgeryChild Q5_K_M.

## What multiple CPU sockets actually buy

Host: 2× Xeon E5-2678 v3, **24 physical / 48 logical** threads in total; Windows reports NUMA0 CPUs 0–23 and NUMA1 CPUs 24–47, SMT sibling pairs (0,1),(2,3),...; 2× GTX750Ti SM5.0, ~2 GiB each, no P2P.

For 96 greedy benchmark output tokens, unpinned 12-thread CPU decode was 6.208 tok/s in one A/B; strict affinity to NUMA socket 0 yielded 2.734, to socket 1 yielded 6.264. Another experiment with **process affinity applied before model load** + NUMA isolate yielded 7.243 on socket 0 but 2.91 on socket 1. These inversions show strong NUMA/cache/background-load effects, **not proof that either socket is intrinsically faster**.

A 24-physical-core `--numa distribute` test achieved prefill 37.903 tok/s but decode only 3.512 tok/s (mmap); `--no-mmap` resulted in prefill 35.903 but decode 2.276. Thus **adding cores helps prefill but not necessarily one-token GEMV**.

### Successful independent prefill/decode worker-count proof, context size 16K

Identical Hestia CPU binary/model/prompt/sampling, `-c 16384`, `-b 512 -ub 256`, 1,477 prompt tokens, greedy 48 output tokens (benchmark only), no context shift:

| Threads | Prefill tok/s | Decode tok/s | Request wall |
| --- | ---: | ---: | ---: |
| `-t 8 -tb 8` | 13.873 | 2.484 | 125.81 s |
| `-t 8 -tb 24` | **28.484** | **2.931** | **68.24 s** |

Output SHA16 identical `a3726593bbc926a5`; measured request wall **45.8% less** in the candidate. Still **only one pair**; *context window 16K is not a 16K-token prompt*. Another probe accepted a genuine 9,482-token input under 16K but was halted during costly prefill before a final answer; **no long-prompt accuracy acceptance**. Never claim that 16K long-context Thinking has been solved.

## Decision and next narrow implementation frontier

1. **Keep model immutable**, especially layer 34 shapes/quantization and attention head surgery. The precise 398-tensor map identifies the expensive **candidate** groups but is not yet a cycle-attribution.
2. In a **sibling copy of the existing Hestia source**, measure cycle time/read throughput of `GGML_OP_MUL_MAT` per tensor name, starting with FFN gate/up/down and tied LM head; inspect x86 Q5_K/Q6_K/Q8 kernels with AVX2/FMA and repack. Determine whether dequantization/GEMV math, DRAM bandwidth or NUMA traffic is limiting in **prefill vs decode**. Do not write modified GGUF weights and do not infer experts for a dense model.
3. **Keep `-t` (decode) and `-tb` (prefill) separately tunable under the existing LivingOS owner/lease**. Candidate `-t8 -tb24` warrants multi-run, multi-prompt p50/p95 and host-contention measurements; production still uses `-t12 -tb12 -c4096`. No second scheduler or perpetual resident process.
4. If testing future GPU placement, prefer limited contiguous compatible whole blocks with VRAM evidence; prioritize **no unnecessary CPU↔GPU transitions** and return to baseline on slower/changed output. Both tested GPU approaches above lose. A cross-device scatter of individual FFN tensors is **not** supported by speed evidence.
5. Run real context gates (4K, 8K, ~12K prompt) with **tokens counted by the model tokenizer**, sentinel facts at head/middle/tail, native Qwen thinking to natural EOS, no artificial think cutoff, correct response and cancellation, RAM floor/host usability, and same-lineage receipts. A token ceiling used exclusively for benchmarking must be labeled censored.
6. Until a matched, repeated CPU kernel/NUMA improvement beats production **and** held-out quality passes, **no production promotion**. Historical `8.78 tok/s` must be remeasured under an identical workload before claiming to exceed it.

**Artifacts local to model lab (measurement evidence):**
`F:\LivingOS\ModelLab\BRIDGE_Brain_Ollama\GGUF_GPU_BRIDGE_TRIAL_V1\HESTIA_WEIGHT_PLACEMENT_CUDA_V4_FA_AUTO_20261017.json`;
`HESTIA_NUMA_24CORE_DISTRIBUTE_20261017.json`;
`HESTIA_SPLIT_T8_TB8_VS_TB24_CONTEXT16K_20261017.json`.

**No change in this weight-hotpath campaign to production Hestia, model, Hestia managed proxy or its BRIDGE optional route.** Test backends were scoped and released. The BRIDGE `11437 -> 8911` optional endpoint added earlier is separate from these sandbox investigations.
