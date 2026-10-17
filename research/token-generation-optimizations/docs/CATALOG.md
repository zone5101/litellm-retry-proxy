# Danh mục kỹ thuật tối ưu sinh token (inference)

**Rà soát:** 2026-10-17. **Ký hiệu:** TG = decode tokens/s một request; TTFT = time to first token; throughput = tổng token/s đa request; VRAM = memory footprint; goodput = lưu lượng đạt SLO. Link trỏ tới mã nguồn, tài liệu hoặc paper **gốc**. Các mục ghi “model-dependent” không thể bật với một tệp GGUF bất kỳ.

**Quan trọng:** số hạng mục không tương đương số thuật toán hoàn toàn độc lập: có hạng mục là kiến trúc model, chính sách scheduler, kernel, hoặc cấu hình triển khai. Các tầng này bổ sung/chồng chéo, không cộng speedup theo phép nhân. Không có chứng nhận độc lập toàn diện cho mọi mục.

## Nén trọng số

Ràng buộc chính: GPU memory bandwidth và chất lượng sau quant. Phải so sánh **với cùng model, hardware, kernel**; nhỏ hơn không tự động nhanh hơn.

| Kỹ thuật | Ảnh hưởng chính | Cơ chế và đánh đổi | Mức áp dụng | Nguồn |
|---|---|---|---|---|
| GGUF K-quants Q4/Q5/Q6 | TG,VRAM | Ít byte tải mỗi token; dequant overhead; Q4 không luôn nhanh nhất | Có sẵn tùy backend | [Nguồn](https://github.com/ggml-org/llama.cpp) |
| GGUF I-quants IQ1/IQ2/IQ3 | VRAM,TG | Cực nhỏ; giải mã có thể chậm hơn K-quants, độ chính xác giảm | Có sẵn tùy backend | [Nguồn](https://github.com/ggml-org/llama.cpp/wiki/Feature-matrix) |
| GPTQ | TG,VRAM | Post-training quantization có hiệu chỉnh lỗi; cần kernel phù hợp | Có sẵn theo runtime | [Nguồn](https://github.com/IST-DASLab/gptq) |
| AWQ | TG,VRAM | Giữ các kênh salient; chất lượng tùy calibration, tốc độ tùy kernel | Có sẵn theo runtime | [Nguồn](https://github.com/mit-han-lab/llm-awq) |
| HQQ | VRAM,TG | Tối ưu hậu lượng tử hóa; encode format không tự bảo đảm decode nhanh | Tùy runtime | [Nguồn](https://github.com/mobiusml/hqq) |
| SmoothQuant W8A8 | TG,throughput | Dịch chuyển độ khó quant giữa weight/activation; cần INT8 hardware | Tùy runtime | [Nguồn](https://github.com/mit-han-lab/smoothquant) |
| FP8 weights/activations | TG,throughput,VRAM | Phù hợp H100/MI300+ và các GPU hỗ trợ; giới hạn sai số số học | Tùy phần cứng | [Nguồn](https://nvidia.github.io/TensorRT-LLM/) |
| FP4 / NVFP4 / MXFP4 | TG,VRAM | Lợi thế lớn nếu GPU/kernels hỗ trợ; không dành cho mọi card | Tùy phần cứng | [Nguồn](https://github.com/NVIDIA/TensorRT-LLM) |
| Marlin INT4×FP16 GEMM | TG,throughput | Kernel chuyên dụng cho GPTQ/AWQ INT4; batching quyết định hiệu quả | Có code | [Nguồn](https://github.com/IST-DASLab/marlin) |
| ExLlamaV2 EXL2 kernels | TG,VRAM | Weight-only GEMM nhanh trên GPU hỗ trợ; phụ thuộc model/format | Có code | [Nguồn](https://github.com/turboderp/exllamav2) |
| Mixed-precision per-layer quant | TG,quality | Cho layer nhạy sai số số bit cao hơn; cần benchmark kernel | Tùy runtime | [Nguồn](https://docs.vllm.ai/en/latest/) |
| 2:4 structured sparsity | TG,throughput | Tăng tốc khi engine/GPU có sparse tensor cores; cần weight tương thích | Model/kernel-dependent | [Nguồn](https://github.com/NVIDIA/TensorRT-LLM) |
| SparseGPT pruning | VRAM,TG | Lược bớt weight; tốc độ thực chỉ tốt khi kernel xử lý sparsity | Phải biến đổi model | [Nguồn](https://github.com/IST-DASLab/SparseGPT) |
| Distillation / smaller student | TG,VRAM | Thay bằng model nhỏ hơn; thay chất lượng/hành vi model | Thay model | [Nguồn](https://huggingface.co/docs/transformers/index) |

## KV cache

Giảm VRAM và lượt đọc K/V. Prefix caching chủ yếu tăng **TTFT** của request lặp, không trực tiếp nhân đôi TG một đoạn sinh đơn.

| Kỹ thuật | Ảnh hưởng chính | Cơ chế và đánh đổi | Mức áp dụng | Nguồn |
|---|---|---|---|---|
| Standard autoregressive KV caching | TG | Không tính lại K,V token cũ; baseline mặc định nhiều runtime | Cơ bản | [Nguồn](https://github.com/ggml-org/llama.cpp) |
| PagedAttention block allocation | throughput,VRAM | Cấp phát KV theo page giảm phân mảnh, tăng batch hữu ích | Server | [Nguồn](https://docs.vllm.ai/en/latest/design/paged_attention/) |
| Automatic Prefix Caching hash blocks | TTFT,throughput | Tái sử dụng KV cho prefix giống hệt; hit-rate quyết định lợi ích | Server | [Nguồn](https://docs.vllm.ai/en/latest/design/automatic_prefix_caching.html) |
| RadixAttention / radix prefix tree | TTFT,throughput | Chia sẻ prefix KV theo cây radix, phù hợp multi-turn | Server | [Nguồn](https://github.com/sgl-project/sglang) |
| Prefix-aware request routing | TTFT,throughput | Ưu tiên worker có cache; có thể làm lệch tải | Nhiều replicas | [Nguồn](https://github.com/sgl-project/sglang) |
| KV-cache q8_0/q4_0 | VRAM,TG | Giảm bandwidth/cache footprint; lỗi lượng tử và dequant overhead | Runtime-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) |
| KIVI 2-bit per-channel K/per-token V | VRAM,throughput | Tăng batch/giảm memory; khác biệt số học so với FP16 | Có code nghiên cứu | [Nguồn](https://github.com/jy-yuan/KIVI) |
| TurboQuant / PolarQuant | VRAM,TG | Quant cực thấp bit có cơ sở nghiên cứu; cần kernel phù hợp và đo chất lượng | Nghiên cứu | [Nguồn](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/) |
| KV offload to CPU/host | Capacity | Đổi VRAM lấy PCIe bandwidth; thường giảm tok/s nếu fetch liên tục | Tùy engine | [Nguồn](https://huggingface.co/docs/transformers/main/en/kv_cache) |
| Tiered KV cache GPU/CPU/SSD | Capacity,throughput | Phục vụ nhiều context bằng memory hierarchy; traffic I/O quan trọng | Server | [Nguồn](https://github.com/sgl-project/sglang) |
| H2O heavy-hitter eviction | VRAM,TG | Giữ token attention quan trọng và gần; xấp xỉ, có thể mất chất lượng | Có code nghiên cứu | [Nguồn](https://github.com/FMInference/H2O) |
| SnapKV observation-based selection | VRAM,TG | Chọn vị trí KV quan trọng theo cửa sổ quan sát; xấp xỉ | Có code nghiên cứu | [Nguồn](https://github.com/FasterDecoding/SnapKV) |
| PyramidKV budget per layer | VRAM,TG | Phân bổ KV không đều theo layer; độ chính xác cần kiểm | Có code nghiên cứu | [Nguồn](https://github.com/Zefan-Cai/KVCache-Factory) |
| Attention sinks / StreamingLLM | long-context,VRAM | Giữ token sink và recent tokens; không giữ toàn bộ quá khứ | Có code | [Nguồn](https://github.com/mit-han-lab/streaming-llm) |
| Sliding window attention | long-context,VRAM,TG | Giới hạn cửa sổ KV; đòi hỏi kiến trúc hỗ trợ, có thể mất thông tin xa | Model-dependent | [Nguồn](https://arxiv.org/abs/2310.06825) |
| Grouped Query Attention (GQA) | TG,VRAM | Nhiều query heads chia KV heads; yêu cầu kiến trúc/trọng số tương thích | Kiến trúc model | [Nguồn](https://arxiv.org/abs/2305.13245) |
| Multi Query Attention (MQA) | TG,VRAM | Một KV head dùng chung cho nhiều query heads; kiến trúc model | Kiến trúc model | [Nguồn](https://arxiv.org/abs/1911.02150) |
| Multi-head Latent Attention (MLA) | TG,VRAM | Nén KV vào latent; cần model MLA và kernel chuyên dụng | Kiến trúc model | [Nguồn](https://arxiv.org/abs/2405.04434) |
| MLA low-rank conversion (MHA2MLA) | VRAM,TG | Chuyển MHA sang MLA phải fine-tune/đánh giá chất lượng | Biến đổi model | [Nguồn](https://arxiv.org/abs/2502.14837) |
| Mamba / selective state space | TG,VRAM | Thay attention bằng SSM có state hữu hạn; kiến trúc khác, không bật flag | Kiến trúc model | [Nguồn](https://github.com/state-spaces/mamba) |
| Hybrid full/sliding/SSM layers | TG,VRAM | Kết hợp local/full/SSM để tiết kiệm cache; hỗ trợ theo model | Kiến trúc model | [Nguồn](https://github.com/sgl-project/sglang) |

## Attention kernel

Mục tiêu là giảm HBM traffic hoặc tạo song song decode; không phải FlashAttention phiên bản càng mới thì mọi GPU/sequence đều nhanh hơn.

| Kỹ thuật | Ảnh hưởng chính | Cơ chế và đánh đổi | Mức áp dụng | Nguồn |
|---|---|---|---|---|
| FlashAttention 1/2/3 | TTFT,TG | IO-aware tiled exact attention; hiệu quả phụ thuộc độ dài và GPU | Có code | [Nguồn](https://github.com/Dao-AILab/flash-attention) |
| FlashDecoding split-KV | TG,long-context | Song song trên chiều chuỗi KV khi decode; chi phí thêm tùy context | Kernel-dependent | [Nguồn](https://crfm.stanford.edu/2023/10/12/flashdecoding.html) |
| FlashInfer decode/prefill kernels | TG,TTFT,throughput | Kernel được tối ưu theo shape, paged/ragged KV | Có code | [Nguồn](https://github.com/flashinfer-ai/flashinfer) |
| FlashMLA | TG,throughput | Kernel attention MLA dành cho DeepSeek và phần cứng hỗ trợ | Model/hardware-dependent | [Nguồn](https://github.com/deepseek-ai/FlashMLA) |
| Cascade attention shared-prefix | throughput,TTFT | Tái sử dụng phần attention chung của batch có prefix trùng | Server | [Nguồn](https://github.com/flashinfer-ai/flashinfer) |
| Fused RoPE + attention | TG,TTFT | Giảm memory traffic và kernel launch; phải đúng RoPE variant | Tùy kernel | [Nguồn](https://github.com/flashinfer-ai/flashinfer) |
| Block-sparse attention | TG,long-context | Bỏ một phần phép attention theo sparsity; có thể xấp xỉ/model-aware | Model-dependent | [Nguồn](https://github.com/flashinfer-ai/flashinfer) |
| POD-Attention fused prefill+decode | throughput | Gộp workload PP và TG vào thiết kế kernel; có lợi batch trộn | Server | [Nguồn](https://github.com/flashinfer-ai/flashinfer) |

## GPU/CPU runtime

Tối ưu scheduling và fused ops. Kernel build/hardware dispatch có thể đảo ngược kết quả; profile trước.

| Kỹ thuật | Ảnh hưởng chính | Cơ chế và đánh đổi | Mức áp dụng | Nguồn |
|---|---|---|---|---|
| Fused RMSNorm / LayerNorm kernels | TG,TTFT | Hạn chế launch/đọc ghi intermediates; decode lợi ích workload-dependent | Có code | [Nguồn](https://github.com/unslothai/unsloth/blob/main/unsloth/kernels/rms_layernorm.py) |
| Fused SiLU/SwiGLU + gated FFN | TG | Gộp elementwise và projection khi có kernel phù hợp | Kernel-dependent | [Nguồn](https://github.com/flashinfer-ai/flashinfer) |
| CUDA/HIP Graph replay | TG,throughput | Bỏ CPU launch overhead với shape/alloc ổn định; tốn memory graph | GPU-dependent | [Nguồn](https://docs.vllm.ai/en/latest/) |
| torch.compile / Inductor | TG,TTFT | Fusion, constant folding, graph specialization; warmup và graph breaks | Runtime-dependent | [Nguồn](https://docs.vllm.ai/en/latest/) |
| Kernel autotuning / tile selection | TG,TTFT | Chọn warp/block tiling hợp shape và GPU; tránh regression | Kernel-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md) |
| Fused dequant+matmul | TG | Dequant tại chỗ tránh materialize full weights; kernel chuyên biệt | Kernel-dependent | [Nguồn](https://github.com/IST-DASLab/marlin) |
| Fused top-k/top-p/min-p sampling | TG | Không cần full vocab sort; lợi ích lớn hơn khi sampling overhead nổi bật | Có code | [Nguồn](https://github.com/flashinfer-ai/flashinfer) |
| GPU layer offload / keep weights resident | TG | Tránh truy xuất qua CPU/PCIe; fit VRAM là điều kiện quan trọng | Có sẵn | [Nguồn](https://github.com/ggml-org/llama.cpp) |
| CPU SIMD AVX2/AVX512/AMX/NEON | TG | Tối ưu matmul CPU theo ISA; memory bandwidth thường vẫn nghẽn | CPU-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp) |
| Pinned host memory + overlap transfer | TTFT,TG | Giảm copy overhead khi offload, nhưng không cứu được PCIe bound | Hardware-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp) |
| Cache-aware batching / tensor padding | throughput | Giảm padding, cache reuse, tối ưu shape để GPU bận liên tục | Server | [Nguồn](https://github.com/vllm-project/vllm) |

## Speculative

Tối ưu trực tiếp **số token được chấp nhận trên mỗi target pass**, nhưng draft overhead/acceptance chi phối kết quả. Muốn giữ phân phối target phải dùng đúng acceptance-rejection correction.

| Kỹ thuật | Ảnh hưởng chính | Cơ chế và đánh đổi | Mức áp dụng | Nguồn |
|---|---|---|---|---|
| Draft-model speculative decoding | TG | Model nhỏ dự đoán k token, target verify song song, correction giữ phân phối nếu đúng | Model-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |
| N-gram / prompt-lookup speculation | TG | Tận dụng các chuỗi lặp; mạnh ở code/structured repetitive outputs | Runtime-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |
| EAGLE-1/2/3 | TG | Dự đoán draft từ feature/token, verification; cần draft weights tương thích | Model-dependent | [Nguồn](https://github.com/SafeAILab/EAGLE) |
| Medusa / multi-head decoding | TG | Nhiều heads đoán token tương lai, tree attention verify | Cần model được trang bị head | [Nguồn](https://github.com/FasterDecoding/Medusa) |
| Multi Token Prediction (MTP) heads | TG | Dùng MTP heads để draft và target verify; cần trọng số MTP tương thích | Model-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |
| Lookahead / Jacobi decoding | TG | Sinh n-gram song song và verify không cần draft model | Có code nghiên cứu | [Nguồn](https://github.com/hao-ai-lab/lookaheaddecoding) |
| Tree-based speculative verification | TG | Gộp nhiều nhánh draft vào một lượt kiểm định target; tài nguyên tăng | Kernel/model-dependent | [Nguồn](https://github.com/SafeAILab/EAGLE) |
| Adaptive speculation / dynamic draft length | TG | Điều chỉnh số draft theo acceptance và chi phí; tránh wasted compute | Runtime-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |
| Self-speculative / early-exit drafting | TG | Dùng một phần layer làm draft; cần kiến trúc hoặc runtime hỗ trợ | Model-dependent | [Nguồn](https://github.com/vllm-project/vllm) |
| DFlash / DSpark drafts | TG | Draft kiểu diffusion/block hoặc hybrid; mới, đòi model đặc thù | Mới/model-dependent | [Nguồn](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) |

## Serving

Đa phần tăng **tổng thông lượng/TTFT/goodput**, không đảm bảo một luồng nhanh hơn; phải đo p50/p95 tail latency.

| Kỹ thuật | Ảnh hưởng chính | Cơ chế và đánh đổi | Mức áp dụng | Nguồn |
|---|---|---|---|---|
| Continuous / in-flight batching | throughput,goodput | Thêm request mới tại ranh giới step; thường cải thiện tổng thông lượng | Server | [Nguồn](https://github.com/vllm-project/vllm) |
| Chunked prefill | TTFT,goodput | Chia prompt dài để xen kẽ decode, tránh starvation | Server | [Nguồn](https://docs.vllm.ai/en/latest/) |
| Disaggregated prefill/decode | goodput,throughput | Tách prefill compute-heavy và decode memory-heavy ra pool GPU | Cluster | [Nguồn](https://github.com/sgl-project/sglang) |
| Scheduling / SLO-aware admission | goodput | Quản lý hàng đợi, giới hạn batch/context, ưu tiên request | Server | [Nguồn](https://github.com/vllm-project/vllm) |
| Multi-LoRA adapter batching | throughput | Dùng chung base model, nhiều adapter một batch; không tăng TG riêng lẻ mặc định | Server | [Nguồn](https://github.com/vllm-project/vllm) |
| Tensor parallelism (TP) | TG,throughput | Chia layer giữa GPU, đánh đổi all-reduce/NVLink latency | Multi-GPU | [Nguồn](https://github.com/NVIDIA/TensorRT-LLM) |
| Pipeline parallelism (PP) | throughput | Chia layer stage; bubble và batch size quyết định | Multi-GPU | [Nguồn](https://github.com/vllm-project/vllm) |
| Expert parallelism + grouped GEMM (MoE) | TG,throughput | Sắp xếp token tới expert; giao tiếp có thể thành bottleneck | MoE/cluster | [Nguồn](https://github.com/flashinfer-ai/flashinfer) |
| Overlap communication/compute | TG,throughput | Che giấu latency all-reduce / dispatch; cần workload đủ lớn | Multi-GPU | [Nguồn](https://github.com/NVIDIA/TensorRT-LLM) |
| KV-aware load balancing | TTFT,goodput | Hướng request tới replica có hot cache nhưng giữ công bằng tải | Multi-replica | [Nguồn](https://github.com/sgl-project/sglang) |

## Cảnh báo kỹ thuật khi diễn giải benchmark

1. **Accuracy vs same distribution:** FlashAttention exact theo toán học nhưng thứ tự phép tính có thể thay bit kết quả; speculative với correction đúng có thể bảo toàn *phân phối lý thuyết*, không cam kết output từng seed/bit trùng. Quantization/pruning/cache eviction **thay** phép toán hoặc trạng thái.
2. **Quant nhỏ ≠ GPU nhanh:** IQ1_S chỉ tiết kiệm storage, dequant overhead đáng kể. So K-quants, I-quants theo cùng GPU. [llama.cpp matrix](https://github.com/ggml-org/llama.cpp/wiki/Feature-matrix).
3. **FlashAttention có thể regression:** có bug reports prefill/decode trên một số CPU/Vulkan. Thử A/B theo phiên bản và backend ([CPU issue](https://github.com/ggml-org/llama.cpp/issues/27086), [Vulkan issue](https://github.com/ggml-org/llama.cpp/issues/27137)).
4. **Speculative acceptance matters:** expected accepted tokens không được cộng thêm miễn phí; draft cost, verification cost, KV cost, sampling correction đều tính vào latency.
5. **Serving throughput khác TG:** batching có thể tăng tổng tokens/s nhưng tăng TPOT từng request. TTFT hit cache cao không chứng minh TG nhanh hơn.
6. **Model architecture khác runtime knob:** GQA/MQA/MLA/Mamba/MTP heads cần model tương thích; không nên 'bật' trên mô hình ban đầu.
7. **Context length:** tối ưu ở 512 tokens chưa chắc lợi tại 128K. KV memory và cache quant mới là nút thắt dài hạn.
8. **Cold/warm:** build/load, compilation, RAM paging, GPU thermal, caching, sample policy đều ghi lại.
9. **Baseline fairness:** giữ cố định weights/quant/precision/engine-build/backend/parallelism/concurrency, trừ biến đang thử.
10. **No synthetic claims:** repo này chưa chạy bench GPU; link công bố từ vendor/paper chỉ chứng minh trong điều kiện gốc.
