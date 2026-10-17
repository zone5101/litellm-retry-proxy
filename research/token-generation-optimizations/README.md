# Token Generation Optimization Atlas (2026)

> Tài liệu nghiên cứu **tăng tốc sinh token LLM tại inference**: nguyên lý, thuật toán, mã nguồn tham chiếu, hạn chế, và cách A/B benchmark. Cập nhật rà soát: **2026-10-17**. Ngôn ngữ: tiếng Việt.

**Quan trọng:** Đây là danh mục các **nhóm kỹ thuật có bằng chứng công khai và triển khai đáng chú ý**, không phải khẳng định liệt kê mọi bài báo từng xuất bản. Không có "cài 1 flag là tự động 2×" cho mọi model/GPU.

## Đọc gì trước?

- [STRICT-FIDELITY.md](docs/STRICT-FIDELITY.md) — **bộ lọc KHÔNG đánh đổi chất lượng**: giữ nguyên weights/precision/full context, phân biệt bitwise exact / numerical equivalent / distribution-preserving speculation; loại bỏ quant/pruning/KV eviction.
- [CATALOG.md](docs/CATALOG.md) — hơn 60 kỹ thuật/biến thể, phân tách **decode throughput / TTFT / server throughput / khả năng nhét model vào VRAM**, có mức độ bằng chứng và đánh đổi.
- [LOCAL-LLAMA-CPP.md](docs/LOCAL-LLAMA-CPP.md) — playbook tối ưu mô hình GGUF trên **Unsloth Desktop/llama.cpp**, đặc biệt cho trường hợp Qwen3.8-27B trong video.
- [SERVING.md](docs/SERVING.md) — chọn vLLM / SGLang / TensorRT-LLM, quyết định batching/prefix caching/disaggregation.
- [BENCHMARK.md](docs/BENCHMARK.md) — quy trình benchmark có đối chứng: PP, TG, TTFT, TPOT, VRAM, chất lượng.
- [SOURCES.md](docs/SOURCES.md) — liên kết mã nguồn chính thức, paper và tài liệu kỹ thuật.
- [techniques.csv](data/techniques.csv) — danh mục máy đọc được.
- [compare_llama_bench.py](scripts/compare_llama_bench.py) — so sánh kết quả JSON từ `llama-bench` (Python stdlib, không cài dependency).
- [test_compare_llama_bench.py](tests/test_compare_llama_bench.py) — 7 unit tests với **dữ liệu giả lập**, không phải benchmark GPU thật.

## Phân biệt 4 mục tiêu không được đánh đồng

| Chỉ số | Giải thích | Tối ưu thường hiệu quả |
|---|---|---|
| **TG / decode tok/s** | Tốc độ sinh token *một luồng* sau khi đã xử lý prompt | GPU offload, matmul quant kernel, speculative decoding, memory bandwidth, KV attention decode |
| **TTFT** | Thời gian chờ đến token đầu tiên, gồm prefill | Prefix reuse, FlashAttention/prefill kernels, chunked prefill, prompt processing |
| **Aggregate tokens/s** | Tổng token/s trên nhiều request | Continuous batching, PagedAttention, FP8, scheduling, KV paging |
| **Goodput / SLO** | Request hoặc token đáp ứng mục tiêu trễ | PD disaggregation, admission control, prefix-aware routing |

*Lưu ý:* `llama-bench` đo PP/TG mức engine, không tính đầy đủ thời gian tokenization/sampling/mạng và không thay benchmark end-to-end.

## Bản đồ nhanh

1. **Máy cá nhân, 1 user, GGUF:** kiểm tra GPU offload → lượng tử hóa cân đối + fit VRAM → `llama-bench` theo PP/TG → flash-attn on/off → KV quant theo context → speculative n-gram/draft/MTP nếu hỗ trợ; không coi IQ1_S luôn nhanh nhất.
2. **Một server nhiều người:** PagedAttention + continuous batching + FlashInfer/FA + prefix caching → weight/KV quant phù hợp → speculative khi throughput và acceptance tốt → chunked prefill/PD split nếu traffic đủ lớn.
3. **MoE / GPU cluster:** fused grouped-GEMM, expert parallelism, overlap communication, FP8/FP4 phù hợp hardware và disaggregated serving.
4. **Nếu cần không đổi phân phối token:** đánh giá numerical exactness riêng với "distribution-preserving" speculative; quantization, pruning, cache eviction có thể thay đầu ra; speculative đúng cơ chế rejection-correction có thể giữ phân phối lý thuyết của target.

## Căn nguyên gây chậm

Với batch nhỏ và decode từng token, thời gian thường bị giới hạn bởi **truy xuất trọng số / băng thông bộ nhớ**, không chỉ bởi FLOPS. Khi context dài, tải **KV cache** cũng thành nút thắt. Khi nhiều request, scheduler/memory fragmentation/queueing quyết định throughput và latency. Một kỹ thuật có thể cải thiện nhánh này nhưng làm nhánh khác xấu đi.

## Bằng chứng và cách đọc

- **[Code]**: có triển khai công khai, không đồng nghĩa nhanh hơn trên máy của bạn.
- **[Paper/vendor bench]**: kết quả do nhóm tác giả hoặc nhà cung cấp công bố; không được coi là tốc độ phổ quát.
- **[Independent measurement]**: cần chạy thực nghiệm cùng phần cứng, trọng số, workload, batch, engine commit, sampling policy, nhiệt độ máy. Repo này **chưa có kết quả benchmark GPU tự đo**, vì vậy **không gán hệ số tốc độ tự đo**.
- **[Model change]**: nếu phải retrain hoặc sửa kiến trúc, không thể "bật" cho GGUF đã có.

## Nguồn gốc liên quan Unsloth

Unsloth [README](https://github.com/unslothai/unsloth/blob/main/README.md) quảng cáo fine-tuning nhanh ~2× / tiết kiệm VRAM; đó **không phải chứng minh** token generation nhanh ~2×. `unsloth_cli/_inference.py` [khởi tạo `LlamaCppBackend`](https://github.com/unslothai/unsloth/blob/main/unsloth_cli/_inference.py#L529-L588) khi chạy GGUF. Do đó phải benchmark đúng đường inference llama.cpp cụ thể.

## Chính sách nội dung

Chỉ tổng hợp, dẫn nguồn và viết code benchmark nguyên bản. Không sao chép hàng loạt kernel bên thứ ba; áp dụng giấy phép riêng của nguồn nếu tái sử dụng code. Không chạy lệnh shell tải/chạy script từ xa khi chưa kiểm tra. Không đưa ví dụ speedup không có điều kiện/nguồn.

## Trạng thái

- Code và tài liệu **đã được rà soát qua nguồn công khai**, nhưng không có tuyên bố QA toàn diện.
- Đã bổ sung 7 unit tests trên dữ liệu giả lập; **chưa thực thi CI/test trên máy thực tế trong phiên này**. GPU performance chưa được đo.
- Chạy unit tests cục bộ bằng `python3 -m unittest discover -s tests -v` từ thư mục Atlas.
- Snapshot ngày 2026-10-17; flags/engine thường thay đổi giữa các release.
