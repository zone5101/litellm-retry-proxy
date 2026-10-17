# Serving nhiều yêu cầu: vLLM, SGLang, TensorRT-LLM

Thước đo mục tiêu: **aggregate output tokens/s**, TTFT p50/p95, TPOT p50/p95, goodput theo SLO, GPU/VRAM/điện năng, failure rate. Một request đơn lẻ có thể KHÔNG nhanh hơn.

## Nên thử kỹ thuật nào?

| Triệu chứng | Giải pháp ưu tiên | Điều kiện |
|---|---|---|
| Model không fit | Quant FP8/FP4/AWQ/GPTQ; tensor/expert parallel | GPU/kernel hỗ trợ, chất lượng vẫn đạt |
| GPU rảnh giữa các token vì ít concurrency | Continuous batching, scheduler | Có đủ lưu lượng |
| OOM nhiều request dù model fit | PagedAttention, KV quant, admission control | Runtime hỗ trợ |
| Lặp system prompt/tool schema | Prefix cache, hash/radix cache, affinity routing | Prefix token IDs/offset thực sự giống |
| Prefill dài chặn decode request đang phục vụ | Chunked prefill + ưu tiên decode | SLO latency rõ |
| Prompt nặng và decode nặng tranh resource | Prefill-decode disaggregation | Có nhiều GPU/pool, chi phí chuyển KV hợp lý |
| Concurrency thấp, mỗi target pass tốn chi phí | Speculative decoding | Draft acceptance cao, memory dư |
| MoE expert dispatch quá chậm | Fused grouped GEMM/EP, overlap communication | Model MoE, interconnect đủ nhanh |
| Time-to-first-token quá lâu với nhiều lời gọi agent | Prefix caching + prefix-aware routing | Đúng key cache, privacy partition |
| GPU launch overhead ở batch nhỏ | CUDA Graph + fused kernels | GPU, shape ổn định, đủ graph memory |

## Engine so sánh

- **[vLLM](https://docs.vllm.ai/en/latest/)**: PagedAttention, continuous batching, APC hash-based, chunked prefill, CUDA graphs, quant FP8/INT4/GGUF theo platform, speculative, PD separation.
- **[SGLang](https://github.com/sgl-project/sglang)**: RadixAttention, prefix reuse cho agentic workload, scheduler, EAGLE spec, FP4/FP8, MoE, PD disaggregation.
- **[TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM)**: NVIDIA-specialized kernels, in-flight batching, FP8/FP4, KV paging, EAGLE/MTP/ngram, distributed runtimes.
- **[llama.cpp](https://github.com/ggml-org/llama.cpp)**: local + CPU/GPU support, GGUF, nhiều backend, kể cả inference đơn luồng; server throughput vẫn cần đo cụ thể.
- **[FlashInfer](https://github.com/flashinfer-ai/flashinfer)**: thư viện kernels (paged/ragged decode/prefill, MLA, Cascade, top-k/top-p), **không phải full server**.
- **[MLX-LM](https://github.com/ml-explore/mlx-lm)**: Apple Silicon; decode with prompt cache, KV quant và speculative trong code `generate.py`.

## Tối ưu theo nhiều tầng không được nhân speedup vô điều kiện

Ví dụ không hợp lệ: `2× FP8 × 2× speculation × 2× batching = 8× cho mọi request`. Trong thực tế:

- FP8 có thể thay nút thắt từ memory-bound sang compute-bound.
- Batch lớn có thể tăng tổng thông lượng nhưng giảm token/s theo từng client.
- Speculation có thể giảm lợi thế khi batch lớn và GPU target đang sử dụng hết.
- Prefix cache làm giảm **prefill**, đặc biệt khi prompt lặp; không thay đổi trực tiếp phép tính decode target.
- Tensor parallel càng nhiều GPU càng có overhead giao tiếp, nếu model đã fit một GPU thì có thể chậm hơn.

## Quy trình benchmark công bằng

1. Cố định **model revision, quant, output distribution, max output tokens, prompt dataset, request arrival profile, context lengths, hardware, engine commit**.
2. Test 1, 4, 16, 64 concurrency; **đừng so sequential của baseline với batch của candidate** rồi gọi là single-user speed.
3. Phân phối prompt: 128/1k/8k/32k; output: 32/128/512; tỷ lệ shared prefixes 0%, 50%, 90%.
4. Ghi result có p50/p95 TTFT, TPOT, E2E, requests/s, output tokens/s, queue wait, GPU memory, OOM, reject/timeouts.
5. Cùng GPU và power envelope, chạy warmups + >=3 lượt; phát hành raw results và command line.
6. Với model quant khác, chạy đánh giá chất lượng riêng (code pass@1 / instruction / reasoning) trước khi so chi phí.

## Chú ý về đúng đầu ra

- FlashAttention/numerical kernels: mathematically equivalent *theo khả năng thuật toán*, có thể có sai lệch floating point do thứ tự cộng.
- Speculative sampling: tính bảo toàn phân phối **chỉ** đúng nếu proposal/accept-reject/correction được triển khai đúng.
- Quant, prune, KV eviction, sliding-window cho model không có SWA là thay đổi đầu ra; không được gọi lossless.
- Caching chia sẻ cần cô lập tenant, tokenizer, sampling constraints, adapter ID, positional/RoPE settings.

## Nguồn

- [vLLM design: APC](https://docs.vllm.ai/en/latest/design/automatic_prefix_caching.html)
- [SGLang repo](https://github.com/sgl-project/sglang)
- [TensorRT-LLM overview](https://github.com/NVIDIA/TensorRT-LLM/blob/main/docs/source/overview.md)
- [FlashInfer](https://github.com/flashinfer-ai/flashinfer)
- [MLX-LM generate.py](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/generate.py)
