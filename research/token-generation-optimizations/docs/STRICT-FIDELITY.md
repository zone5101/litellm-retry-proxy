# STRICT FIDELITY: tối ưu inference mà không chủ ý giảm chất lượng

**Mục tiêu của người dùng:** chỉ lấy thuật toán/tổ chức tính toán để tăng tokens/s; không đổi trọng số mô hình, quant/precision, không bỏ token ngữ cảnh, không pruning, không đổi kiến trúc, không nới luật sampling. Cập nhật 2026-10-17.

## Định nghĩa để tránh đánh tráo khái niệm

- **A – giữ nguyên trạng thái và thao tác logic:** đổi caching, scheduling, GPU residency, phân bổ KV nhưng giữ nguyên **tất cả** token, weights và K/V ở cùng dtype. Có thể sinh cùng chuỗi bit nếu điều kiện xử lý/sampling tính toán không đổi.
- **B – toán học tương đương nhưng thứ tự floating-point khác:** FlashAttention / FlashDecoding, fused kernels, tiled GEMM, Tensor Parallel, CPU vectorization. Không cố ý xấp xỉ mô hình nhưng sai số floating nhỏ có thể làm argmax đổi ở trường hợp biên.
- **C – bảo toàn phân phối xác suất target (đúng điều kiện):** speculative decoding có rejection/correction, không phải chấp nhận 'gần đúng' và cũng không phải đảm bảo cùng chuỗi token ở cùng seed với mọi backend. Greedy có thể so token exact nếu implementation và numerics kiểm soát.
- **D – bị loại:** mọi cách bỏ/chuyển trọng số, giảm precision, bỏ/ngắn KV, bỏ ngữ cảnh, thay kiến trúc hay nới quy tắc chấp nhận.

## Nhóm 1: không tính lại thứ đã tính

| Kỹ thuật | Cơ chế | Mục tiêu | Điều kiện strict |
|---|---|---|---|
| KV cache chuẩn | Lưu lại K,V từ các token quá khứ, attention token mới dùng lại | TG | **Full KV**, dtype gốc, không eviction/compression |
| Prefix caching / RadixAttention | Tái sử dụng KV cho một prefix token-ID, position, model, adapter giống hệt | TTFT, throughput | Key có đủ tensor semantics; cache biệt lập theo tenant |
| PagedAttention (KV paging) | Ánh xạ logical blocks sang physical memory blocks, tránh phân mảnh | throughput/VRAM | **Không** quant hoặc drop KV |
| Reuse attention metadata | Cache/reuse bảng index, positional metadata, masks khi tương đương | CPU overhead | Cache keys đúng, không tái dùng stale |

## Nhóm 2: vẫn cùng phép toán, thực thi hiệu quả hơn

| Kỹ thuật | Cơ chế | Mục tiêu | Điều kiện strict |
|---|---|---|---|
| FlashAttention 2/3 | Tile/QKV và online softmax, giảm HBM IO | TTFT, long-context TG | Full exact attention; kiểm tolerance FP |
| FlashDecoding | Chia KV dài thành nhiều split song song rồi merge softmax | TG context dài | Exact attention math, kiểm sai số |
| FlashInfer / optimized decode attention | Chọn kernel, layout, split tùy shape | TG | Không dùng approximate sparse/sliding variants |
| Kernel fusion | Gộp Norm/RoPE/activation/residual | TG | Không thay dtype/số học chủ đích; tolerance |
| Fused GEMM / tensor-core optimized GEMM | Tiling, prefetch, memory coalescing, autotuning | TG/TTFT | Giữ precision; TF32 phải xem là giảm precision nếu ban đầu FP32 |
| CUDA Graphs | Capture/replay lệnh GPU thay nhiều CPU dispatch | TG | Dữ liệu/shape/allocator tương thích |
| CPU SIMD/ISA scheduling | AVX/AMX/NEON thread pinning, NUMA, cache-aware layout | TG CPU | Không đổi dtype/precision |
| GPU residency/offload scheduling | Giữ weights+KV cùng GPU tránh PCIe copy | TG | Giữ nguyên weights+KV full precision, đủ VRAM |
| Tensor parallel / row parallel | Chia phép nhân nhiều GPU và reduce kết quả | TG nếu tốt | GPU interconnect nhanh, floating order tolerance |
| MoE grouped GEMM / expert parallel | Gộp token theo experts, giữ routing/top-k như model gốc | TG/throughput | Chỉ model MoE đã có; không skip experts |

## Nhóm 3: nhiều token mỗi lượt target — exact target distribution **nếu triển khai đúng**

| Kỹ thuật | Cơ chế | Điều kiện |
|---|---|---|
| Draft-model speculative | Draft nhỏ sinh k token, target verify song song | Greedy strict-match hoặc stochastic rejection+corrected sampling |
| Prompt lookup / n-gram speculation | Đề xuất đoạn lặp từ prompt/cache, target verify | Không accept nếu target không cho phép |
| EAGLE-3 | Dự đoán từ hidden-state của target rồi verify | Cần draft trọng số tương thích; chuẩn rejection/correction |
| MTP heads | Head tương thích đề xuất token tương lai | Model phải có MTP; strict verification |
| Medusa tree / tree speculation | Multi-head dự đoán nhánh rồi target verify một lần | Chỉ cấu hình đúng target distribution, tránh relaxed accept |
| Adaptive draft length | Điều chỉnh k theo acceptance ratio để tránh overhead | Không thay luật accept/correction |

**Pseudocode lý thuyết:** draft proposes A B C D → target xem logits tất cả vị trí trong một lần → chỉ nhận A,B nếu hợp lệ → token C dùng quyết định/correction theo target → bỏ các dự đoán còn lại và lặp. Với sampling, so argmax không đủ để bảo toàn phân phối; cần rejection/correction chính xác. [Paper](https://arxiv.org/abs/2211.17192), [llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md).

## Nhóm 4: điều phối / scheduling (đặc biệt nhiều yêu cầu)

Continuous batching, chunked prefill, decode-preferred scheduling, async CPU/GPU overlap, SLO-aware dispatch, prefix-aware routing, prefill/decode disaggregation. Không làm mất chất lượng mô hình nếu toàn bộ request + KV được xử lý chuẩn, nhưng **thường chỉ tăng aggregate throughput hoặc TTFT, không chắc tăng TG của 1 người**. [vLLM](https://docs.vllm.ai/en/latest/).

## Loại bỏ hoàn toàn khỏi chế độ strict

- Weight quantization khác bản gốc (INT4/INT8/FP8/FP4/GGUF Q4/Q2), kể cả "chất lượng gần như không giảm": **không đạt ràng buộc**.
- KV cache quant, KV eviction (H2O/SnapKV/PyramidKV), sparse attention approximate, attention truncation, sliding window không phải kiến trúc gốc.
- Pruning, distillation, low-rank conversion, MHA→MLA, MoE expert skip, đổi GQA/MQA hoặc thay model.
- Relaxed/fuzzy/loosely speculative acceptance, bỏ verification, dùng token từ draft chưa được target đồng ý.
- Chuyển sang TF32 khi baseline FP32 nếu coi precision bất biến; thay top-p/top-k/temperature cũng không được.
- Thay context window bằng truncation để chạy nhanh.

## Sự thật về 'giữ chất lượng tuyệt đối'

Các thuật toán exact attention giữ **cùng hàm toán**, nhưng floating-point addition không kết hợp: `(a+b)+c` có thể khác `a+(b+c)` theo bit. [FlashAttention implementation](https://github.com/Dao-AILab/flash-attention) so đầu ra theo **numerical tolerance**, không yêu cầu bitwise. Ngay cả speculative decode greedy đôi khi lệch vì target forward theo batch khác một-token forward, xem [llama.cpp issue #25618](https://github.com/ggml-org/llama.cpp/issues/25618). Muốn đảm bảo **chuỗi token giống 100% trong mọi prompt**, cần bitwise/deterministic-path tests, có thể phải loại bớt kernel song song/fusion.

## Thứ tự tối ưu cho local Unsloth/llama.cpp, một người

1. Kiểm tra **cùng một file GGUF** và GPU residency / memory utilization; không đổi quant.
2. Đo TG nền với [llama-bench](https://github.com/ggml-org/llama.cpp/tree/master/tools/llama-bench) (chú ý TG != PP).
3. A/B flash-attn và kernel backend, không thay dtype.
4. Test exact speculative n-gram hoặc draft nhỏ tương thích khi có lợi, xác minh output/generation distribution.
5. CUDA graphs / fused kernel tùy runtime hỗ trợ; không bê các kernel training của Unsloth sang llama.cpp rồi mặc định hưởng lợi.
6. Nếu workload nhiều request hoặc repeated prefix: thêm prefix caching/PagedAttention/scheduling.
7. Báo cáo cả TG, TTFT, RAM/VRAM, chất lượng và các prompt diverge. Không bịa hệ số tăng tốc.

## Tài liệu chuẩn

- [FlashAttention](https://github.com/Dao-AILab/flash-attention)
- [FlashInfer](https://github.com/flashinfer-ai/flashinfer)
- [Speculative Decoding](https://arxiv.org/abs/2211.17192)
- [llama.cpp speculative methods](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md)
- [vLLM prefix cache semantics](https://docs.vllm.ai/en/latest/design/prefix_caching/)
- [vLLM CUDA Graph](https://docs.vllm.ai/en/latest/design/cuda_graphs/)
