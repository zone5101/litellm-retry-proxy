# Hestia SurgeryChild — read actual llama.cpp scheduler before more inference tuning

**Date** 2026-10-17. **Status**: local source audit and CPU-only bounded A/B **complete**; **production unchanged**. Do not conflate this with a permanent Hestia speed improvement, 8K+ accuracy proof, or independent BRIDGE end-to-end speed-up.

## 1. Exact identity and source

Hestia GGUF: `Qwen3-4B-Thinking-2507.Hestia-P001.SurgeryChild-QHead10Sext.Q5_K_M.gguf`, SHA256 `4cf2067b66bfed33c897a5528de068522f5633e743c6477691cb2835a8d07a9d`, 36 dense blocks, atypical width 8320 at FFN block 34.

**Inspect the exact compatible source lineage instead of projecting upstream defaults:**
`D:\LivingOS_lab\qwen3_20260908\sandbox\src\qvac_loader_ffn_v1_server_b10964`

Read lineages:
- `src/llama-context.cpp:2466-2487`: `graph_compute(..., batched)` selects **`n_threads_batch` and `threadpool_batch`** for batch/prefill, **`n_threads` and `threadpool`** for decode, injects the selected pool into CPU backend, and calls `ggml_backend_sched_graph_compute_async`.
- `ggml/src/ggml-cpu/ggml-cpu.c:1340-1527`: `GGML_OP_MUL_MAT` calls a quant-aware `vec_dot` selected by `ggml_cpu_select_vec_dot`; partitions matrix rows into chunks, workers acquire additional chunks via `atomic_fetch_add_explicit` on `current_chunk`. For GEMV its chunk granularity increases (e.g. 64 when `nr1==1`).
- `ggml-cpu.c:3220-3290`: worker loops the compute graph and **barriers between computed nodes**, so adding workers can increase synchronization/cache-line bouncing.
- `ggml-cpu.c:3429-3578`: **OpenMP path** creates `#pragma omp parallel num_threads(n_threads)`; non-OpenMP uses GGML-owned persistent threadpool and its own barriers. Both have a CPU-mask apply path.
- `ggml-cpu.c:712-798` and `2270-2345`: `ggml_numa_init` and `set_numa_thread_affinity` have **`#if __gnu_linux__`** implementations; on Windows the corresponding NUMA path is **TODO/no-op**. `--numa isolate|distribute` does **not** establish Windows NUMA memory/thread locality in this source.
- `ggml-cpu.c:2637+`: Windows **manual thread CPU affinity does work** via `SetThreadAffinityMask`; `-C/--cpu-strict` and `-Cb/--cpu-strict-batch` can control placement separately, even though the `--numa` strategy itself is ineffective.
- `ggml/src/ggml-cpu/arch/x86/quants.c:2224`: `ggml_vec_dot_q5_K_q8_K` **already contains AVX2/FMA code**. Avoid claiming no AVX2 support.
- `ggml/src/ggml-cpu/repack.cpp:4763+`: **optimized repack paths for Q5_K/Q6_K in this source select ARM NEON**, not AVX2. This is different from saying the ordinary Q5_K/Q6_K AVX2 dot kernel is missing. A new AVX2 repack/GEMV kernel would require exact numerical and batch/decode A/B proof.

Upstream independent observations: [ggml CPU implementation](https://github.com/ggml-org/llama.cpp/blob/master/ggml/src/ggml-cpu/ggml-cpu.c), [llama.cpp 2026 server/OpenMP regression](https://github.com/ggml-org/llama.cpp/issues/27084) (upstream fixed in later releases, **not proof Hestia contains that exact regression**), [2026 CPU OpenMP barrier discussion](https://github.com/ggml-org/llama.cpp/issues/26200).

## 2. A separate, exactly compatible native-threadpool build

Existing deployed CPU server lineage:
`D:\LivingOS_lab\qwen3_20260908\sandbox\build_hestia_server_custom_v1\bin\Release\Hestia.exe`, `GGML_OPENMP=ON`.

Created and compiled an **independent sibling** from identical source:
`D:\LivingOS_lab\qwen3_20260908\sandbox\build_hestia_noopenmp_cpu_20261017\bin\Release\llama-server.exe`
SHA256 `2d8f71ef01c2d0af69421dcd814ba43a77954c356303740bafaadd50a262c3cd`.
CMake `GGML_OPENMP=OFF`, `GGML_NATIVE=ON`, `GGML_CUDA=OFF`; detected MSVC AVX2/FMA, no AVX512. No source edits, GGUF edits, new background scheduler, process ownership or production cutover. Web UI bundling caused unnecessary build delay; sibling eventually built successfully.

**Strict same-request A/B**, context 16384, `-t8 -tb24`, `-b512 -ub256`, `q8_0` KV, `-fa auto`, fixed greedy/seed, 48 predicted tokens **BENCHMARK CAP ONLY**, disable context shifting:

| Prompt | OpenMP production-engine sibling | Non-OpenMP native threadpool | Response parity |
| --- | --- | --- | --- |
| short 28 prompt tokens | 2.977 tok/s decode, 17.05 s request | **4.147 tok/s**, 12.39 s | same SHA16 `39bfff1fbc015bc8` |
| medium 1474 prompt tokens | 2.651 tok/s decode, 72.68 s | **3.474 tok/s**, 63.67 s | same SHA16 `a3726593bbc926a5` |

=> Measured +39.3% and +31.0% decode, 27.3% and 12.4% lower request latency. **Single A/B pair only**; no p50/p95 significance, user-facing natural EOS, quality or 8K+ input validation. Evidence: `F:\LivingOS\ModelLab\BRIDGE_Brain_Ollama\GGUF_GPU_BRIDGE_TRIAL_V1\HESTIA_OPENMP_VS_NATIVE_POOL_20261017.json`.

## 3. Native threadpool CPU/affinity sweep, exact 96-token greedy same-output cases

Context 16K, `-tb 24`, no speculative, Q5 surgery model unchanged, same CPU sibling binary:

| Decode profile | tok/s (one run) |
| --- | ---: |
| 6 worker unpinned | 2.673 |
| 8 unpinned | 4.167 |
| 10 unpinned | 4.454 |
| 12 unpinned | 5.227 |
| 8 physical worker / NUMA0 mask `0x555555` | 5.699 |
| 8 physical worker / NUMA1 mask `0x555555000000` | 2.879 |
| 8 unpinned `--poll 0` | 3.217 |
| 8 unpinned `--poll 100` | 3.202 |

Follow-up physical-core sweep, still same GGUF and 96-token greedy output:
- 4 physical on node0: 3.213 tok/s
- 6 physical node0: 3.355
- **8 physical node0 REPEAT: 3.178** (original 5.699; serious host-load variance)
- 12 physical node0: **6.488** (highest observed *in this sweep*)
- 12 physical node1: 2.848
- 16 physical across nodes: 6.300

All above output SHA16 = `b2dd7912fe199932`. Sampled socket/host CPU utilization differed. The 8-node0 repeat shows why **one lucky tok/s measurement cannot be used to promote an affinity policy**. "Hardware limit reached" is **not proven**. Single-run historical 8.78 tok/s not reproduced under identical conditions.

Evidence:
- `HESTIA_NOOMP_THREAD_MASK_POLL_AB_20261017.json`
- `HESTIA_NOOMP_PHYSICAL_CORE_SWEEP_20261017.json`

## 4. Separate decode/prefill CPU placement, same 1,477-token medium input

`-t12 -tb24 -c16384`, decode `-C 0x555555 --cpu-strict 1`, BENCHMARK output 48 tokens, same hash `a3726593bbc926a5`:

| Batch mask | Prefill | Decode | Wall |
| --- | ---: | ---: | ---: |
| node0 physical 12 (`-Cb 0x555555`) | 28.763 tok/s | 5.334 tok/s | 60.36 s |
| all 24 physical (`-Cb 0x555555555555`) | 29.629 tok/s | 5.504 tok/s | 58.58 s |

One pair gives ~3% wall-time gain, **below reliable acceptance without repetitions**; cross-socket access may reverse under different loads. Output hash matches existing deterministic greedy cases. Evidence: `HESTIA_SEPARATE_CPU_MASKS_PREFILL_DECODE_20261017.json`.

## 5. Actual >4K input prefill stress test: negative result (important)

A final **real tokenized** >4K test was run with the same exact SurgeryChild SHA/model, **non-OpenMP sibling**, `-c 16384`, `-t12 -tb24`, decode CPU mask node0 physical, batch mask 24 physical across both NUMA nodes, `--no-context-shift`, K/V `q8_0`, Flash Attention auto and reasoning budget -1.

The model's `/tokenize` endpoint counted **5,781 input tokens** from 95 synthetic records with head/middle/tail sentinels. The benchmark deliberately requested **`n_predict=1` ONLY to isolate prefill latency**. Despite this, `/completion` **did not return within 350 seconds**, and urllib raised `TimeoutError: timed out`. The test therefore has status **FAIL / no completion**, not a 16K context performance/accuracy PASS. Do not calculate prefill throughput from it or assume a token was generated; it may be compute stall, cross-socket memory contention or a responsiveness failure. Exact cause was not isolated. It does demonstrate an unacceptable >350s client-perceived result for this workload.

The script released its owned process/Windows Job and LivingOS lease. Follow-up machine query showed **no LISTENING backend on 18913**, `8911` alive with `model_resident=false`, `active_requests=0`, `resource_lease_active=false`, and BRIDGE `11437` alive.

Evidence: `F:\LivingOS\ModelLab\BRIDGE_Brain_Ollama\GGUF_GPU_BRIDGE_TRIAL_V1\HESTIA_NATIVEPOOL_REAL_LONG_CTX_PREFILL_20261017.json`. This is negative evidence, and forbids claiming validated 5.8K/8K/16K inference. A future shorter >4K probe with incremental progress instrumentation and native per-op timing would be needed before any context promotion.

## 6. Limits, operator constraints, and next actual engineering frontier

1. **Do not confuse context capacity with context retrieval quality.** A prior 9,482-token input was admitted at `-c16384` but test halted during prefill. This neither passes accuracy nor demonstrates natural EOS at 9K tokens.
2. **No production mutation in this campaign.** Current Hestia owner `rock_man/hestia_resident_runtime.py` still uses `-t12 -tb12 -c4096` and releases model after each request. The BRIDGE optional `11437/hestia/completion` route registered previously remains separate. Do not bypass BAM leases or start a duplicate permanent backend.
3. A serious next optimization is source-level **per-op wall and stall attribution** for GGML Q5_K/Q6_K dot and memory prefetch, barrier time, and targeted **Windows NUMA page-placement** (no support in current GGML). Code changes must be sibling-built then compared on unmodified model/tokens. Do not assume modified weight quantization, expert cache, or GPU offload is beneficial.
4. GTX 750 Ti dual GPU last12-block offload and tied output-only offload already **regressed** against CPU on exact surgery model; n-gram speculative and 24-thread decode also regressed in earlier experiments.
5. To promote, require idle/busy baseline, repeated alternating A/B order, 4K/8K/12K **actual tokenized prompt lengths**, full natural-EOS thinking without forced tags, exact retrieval at head/middle/tail, cancellation/lease receipts, and no quality regression.

**Decision:** Preserve production. The biggest demonstrated one-shot benefit is **building without OpenMP**; adding CPU cores alone is not enough. Model weight layout and AVX2 native dot kernels suggest a next research frontier, not an established upper bound.
