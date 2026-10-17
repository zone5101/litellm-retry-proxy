# Sources — tài liệu và mã nguồn gốc

Danh sách ưu tiên **upstream/project chính thức**. Khi dẫn con số tốc độ, đọc điều kiện thử nghiệm trong paper; kết quả vendor/nhóm tác giả không mặc định độc lập. Snapshot 2026-10-17.

## Runtimes, nguồn code triển khai

1. **llama.cpp** — [repo](https://github.com/ggml-org/llama.cpp), [speculative methods](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md), [llama-bench](https://github.com/ggml-org/llama.cpp/tree/master/tools/llama-bench), [feature matrix](https://github.com/ggml-org/llama.cpp/wiki/Feature-matrix), [build kernels](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).
2. **Unsloth** — [repo](https://github.com/unslothai/unsloth), [GGUF load path](https://github.com/unslothai/unsloth/blob/main/unsloth_cli/_inference.py#L529-L588), [training RMSNorm Triton](https://github.com/unslothai/unsloth/blob/main/unsloth/kernels/rms_layernorm.py). Lưu ý các kernel tối ưu **training** của Unsloth không đồng nhất với inference llama.cpp.
3. **vLLM** — [repo](https://github.com/vllm-project/vllm), [docs](https://docs.vllm.ai/en/latest/), [automatic prefix caching](https://docs.vllm.ai/en/latest/design/automatic_prefix_caching.html), [architecture explanation](https://vllm.ai/blog/2025-09-05-anatomy-of-vllm).
4. **SGLang** — [repo](https://github.com/sgl-project/sglang), [Unified Radix Cache README](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/mem_cache/unified_cache/components/README.md).
5. **NVIDIA TensorRT-LLM** — [repo](https://github.com/NVIDIA/TensorRT-LLM), [overview](https://github.com/NVIDIA/TensorRT-LLM/blob/main/docs/source/overview.md).
6. **FlashInfer** — [repo](https://github.com/flashinfer-ai/flashinfer), optimized decode/prefill, MLA/Cascade/sampling.
7. **MLX-LM** — [repo](https://github.com/ml-explore/mlx-lm), [generate.py](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/generate.py), Apple Silicon, KV cache quant và speculative.
8. **MLC LLM** — [repo](https://github.com/mlc-ai/mlc-llm), model compilation/hardware specialization.

## Speculative / parallel decoding

- **Leviathan et al. 2023** — *Fast Inference from Transformers via Speculative Decoding*: [paper](https://arxiv.org/abs/2211.17192), distribution-corrected speculative sampling.
- **Speculative decoding variants in llama.cpp** — [official documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md), gồm ngram, draft-simple, EAGLE3, DFlash, DSpark, MTP, tuỳ model/binary.
- **EAGLE-1/2/3** — [code](https://github.com/SafeAILab/EAGLE), [EAGLE-3 paper](https://arxiv.org/abs/2503.01840). EAGLE-3 công bố speedup *up to* 6.5× trong benchmark paper; con số không phổ quát.
- **Medusa** — [code](https://github.com/FasterDecoding/Medusa), multi-head/tree decoding.
- **Lookahead Decoding** — [code](https://github.com/hao-ai-lab/lookaheaddecoding), [paper](https://arxiv.org/abs/2402.02057).
- **Survey parallel decoding** — [ZinYY/Awesome-Parallel-Decoding](https://github.com/ZinYY/Awesome-Parallel-Decoding) là tài liệu cộng đồng, cần kiểm chứng lại upstream từng mục.

## Attention, operators & KV cache

- **FlashAttention 1,2,3** — [official code](https://github.com/Dao-AILab/flash-attention), [FA1 paper](https://arxiv.org/abs/2205.14135), [FA2 paper](https://arxiv.org/abs/2307.08691).
- **FlashDecoding** — [article](https://crfm.stanford.edu/2023/10/12/flashdecoding.html), chia workload decode across KV sequence.
- **FlashMLA** — [code](https://github.com/deepseek-ai/FlashMLA).
- **Grouped Query Attention** — [paper](https://arxiv.org/abs/2305.13245); khác với MHA tại model level.
- **Multi-head Latent Attention / DeepSeek-V2** — [paper](https://arxiv.org/abs/2405.04434), giảm KV memory thông qua compressed latent.
- **KIVI 2-bit KV cache** — [paper](https://arxiv.org/abs/2402.02750), [code](https://github.com/jy-yuan/KIVI).
- **TurboQuant** — [Google Research blog (2026-03-24)](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/); chỉ coi là research claim khi chưa tự benchmark.
- **StreamingLLM attention sinks** — [code](https://github.com/mit-han-lab/streaming-llm).
- **H2O cache eviction** — [code](https://github.com/FMInference/H2O).
- **SnapKV** — [code](https://github.com/FasterDecoding/SnapKV).
- **PyramidKV / KVCache-Factory** — [code và nhiều biến thể khác](https://github.com/Zefan-Cai/KVCache-Factory).
- **PagedAttention** — [vLLM](https://docs.vllm.ai/en/latest/), memory allocation khác exact attention math.

### KV Cache Factory: các nhánh nghiên cứu mở rộng

Trong [KVCache-Factory](https://github.com/Zefan-Cai/KVCache-Factory), ngoài H2O, SnapKV, PyramidKV còn **Quest, NACL, Scissorhands, MiniCache, AdaKV, HeadKV, ThinK, HeadInfer, KVQuant, GEAR, CAM, L2Norm**. Những mục này nên được phân loại là **nghiên cứu/điều kiện triển khai**, không khẳng định tự động nhanh hơn. Đặc biệt HeadInfer tập trung offloading chính xác thay vì nén xấp xỉ.

## Weight quantization / kernels

- **GPTQ** — [code](https://github.com/IST-DASLab/gptq).
- **AWQ** — [code](https://github.com/mit-han-lab/llm-awq).
- **HQQ** — [code](https://github.com/mobiusml/hqq).
- **SmoothQuant** — [code](https://github.com/mit-han-lab/smoothquant).
- **Marlin INT4 kernels** — [code](https://github.com/IST-DASLab/marlin); paper/README claim gần 4× trong điều kiện cấu hình mục tiêu, không suy rộng.
- **ExLlamaV2** — [code](https://github.com/turboderp/exllamav2).
- **FP8/FP4 optimized kernels** — [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM), phụ thuộc GPU.

## Cảnh báo chọn nguồn

- `README` của dự án thường chứa speedup do chính nhóm tác giả đo. Chúng là bằng chứng kỹ thuật **không độc lập**.
- GitHub source chứng minh tính hiện hữu/thiết kế, **không đủ** chứng minh speedup hay an toàn toàn bộ binary.
- Các wiki/lệnh flags thay đổi theo release; kiểm tra `--help` trên binary.
- Dự án nghiên cứu có thể cần model weights, GPU CUDA, hoặc patch transformers cũ; không tự tích hợp vào Unsloth.
- Đừng sao chép mã nguồn bên thứ ba vào repo này nếu không theo giấy phép; đây là tổng hợp kỹ thuật và links.

## Danh mục bổ sung để tiếp tục cập nhật

Phạm vi "tất cả" là bất khả thi theo nghĩa mọi thuật toán đang được nghiên cứu. Ưu tiên theo dõi:
1. [vLLM release notes](https://github.com/vllm-project/vllm/releases)
2. [llama.cpp changes](https://github.com/ggml-org/llama.cpp/commits/master/)
3. [SGLang release notes](https://github.com/sgl-project/sglang/releases)
4. [FlashInfer](https://github.com/flashinfer-ai/flashinfer/releases)
5. [Parallel decoding survey](https://github.com/ZinYY/Awesome-Parallel-Decoding)

Không tự nhập speedup từ các PR/issue chưa xác nhận.
