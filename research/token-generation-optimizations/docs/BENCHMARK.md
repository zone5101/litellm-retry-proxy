# Benchmark protocol: đo tốc độ sinh token thật

Tài liệu này cố ý **không chứa số đo GPU chưa thực hiện**.

## Công thức

- `TTFT` = từ lúc request được gửi cho đến lúc client nhận token đầu tiên.
- `TPOT` = (thời điểm token cuối − thời điểm token đầu) / (số output token − 1), dùng khi output >= 2.
- `Output tok/s` = số token sinh / thời gian sinh theo định nghĩa benchmark được công bố (phải nói rõ có bao gồm first-token/prefill không).
- `Aggregate output tok/s` = tổng output tokens / wall-clock quan sát cho tất cả requests.
- `Goodput` = output hoặc requests thỏa SLO deadline / wall-clock.
- `Speedup` = baseline latency / candidate latency cho latency, hoặc candidate t/s / baseline t/s cho rate.
- `Accepted draft ratio` = accepted_draft_tokens / proposed_draft_tokens. **Không đồng nhất** ratio này với speedup.

## Thiết kế thí nghiệm công bằng

### Lớp 1: decode kernel/TG (nhanh, reproducible)

Dùng `llama-bench`:
```bash
./llama-bench -m /path/to/model.gguf -p 512 -n 128 -r 5 -o json > base.json
# chỉ đổi 1 yếu tố (flash-attn / KV dtype / gpu offload / quant)
./llama-bench -m /path/to/model.gguf -p 512 -n 128 -r 5 -fa on -o json > new.json
python3 scripts/compare_llama_bench.py base.json new.json
```

**Sai lầm:** `pp512` là prompt processing, `tg128` là text generation, đừng lấy số pp512 làm tốc độ sinh chữ. `llama-bench` không bao gồm thời gian tokenizer/sampling/network. Dùng `-d 4096` hoặc sâu hơn để đo decode context dài.

### Lớp 2: end-to-end 1 người dùng

Chạy **20–50 prompt cố định**: code completion/refactor, reasoning, Vietnamese, long-context. Cố định:
- model *và revision*, quant, chat template, max_new_tokens, temperature/top_p/top_k, seed khi có thể;
- GPU, RAM/VRAM, device layers, firmware/driver, OS, runtime commit, exact launch flags;
- prompt length token IDs, output length thực tế, prefill/decode separate timing;
- cold startup và warm runs, không trộn;
- concurrency = 1, và phát hành p50/p95 TTFT, TPOT, E2E.

Đối với sampling ngẫu nhiên, seed cố định có thể vẫn cho sequence khác giữa kernel/quant. Cần báo cáo số output tokens và dùng workload đủ lớn.

### Lớp 3: server load

Matrix:
```
Concurrency: 1, 4, 16, 64
Input length: 128, 1024, 8192, 32768
Output target: 32, 128, 512
Repeated prefix: 0%, 50%, 90%
Arrival: steady / bursty
```
Theo dõi throughput, request/s, TTFT/TPOT p50/p95/p99, 429/OOM/timeouts, GPU memory, GPU util, queue wait, host RAM, cost/token.

### Lớp 4: accuracy/non-regression

- **Giữ cùng model/precision:** code compile+unit test, exact-or-tolerant logits comparison, sampling policy sanity.
- **Quant thay trọng số:** đánh giá code pass@1, correctness, language, reasoning, perplexity nếu có và quality score trước khi nhận speedup.
- **KV compression/eviction:** long-context retrieval/needle-in-haystack và multi-turn consistency.
- **Speculative:** verify phân phối, correction, acceptance, draft memory overhead; với greedy dễ so exact tokens hơn (cần kiểm soát floating-point).

## Cách đọc output script

`compare_llama_bench.py` nhận 2 JSON array từ `llama-bench -o json`, ghép cùng `n_prompt,n_gen,n_depth`; mặc định **từ chối** GPU/backend/model/build mismatch. Cho đổi model/quant dùng `--allow-model-change` và **bắt buộc đánh giá chất lượng riêng**. Cho so phiên bản build khác dùng `--allow-build-change`, nhưng nhãn thí nghiệm đã thay đổi và không thể quy hoàn toàn tốc độ cho một thuật toán.

Đường dẫn ví dụ nếu đứng tại thư mục gốc Atlas:
```bash
python3 scripts/compare_llama_bench.py base.json candidate.json --json-out report.json
```

## Cấu trúc record đề xuất

```json
{
  "run_id": "your-experiment-id",
  "runtime": "llama.cpp",
  "commit": "<actual git commit>",
  "hardware": "<actual GPU CPU RAM VRAM and interconnect>",
  "model": "<actual model path and SHA256>",
  "params": {"n_ctx": 8192, "ngl": "record the actual runtime value"},
  "workload": {"prompt_tokens": 1024, "output_tokens": 128, "concurrency": 1},
  "metrics": {
    "ttft_p50_ms": null,
    "tpot_p50_ms": null,
    "output_tps": null,
    "peak_vram_gb": null
  },
  "quality": "not tested"
}
```

`null` là chưa đo, không được thay bằng số đo giả. Không đưa số demo vào báo cáo thật.

## Lỗi benchmark thường gặp

1. Không so giữa máy/binary/driver khác nhau rồi kết luận một flag nhanh hơn.
2. Không trộn model Q4 và IQ1 mà khẳng định chất lượng tương đương.
3. Không lấy vendor figures từ H100 rồi áp cho RTX phổ thông/CPU.
4. Không gọi prefix-cache speedup là TG-per-user speedup.
5. Không đo ở context 128 rồi extrapolate tuyến tính lên 128K.
6. Không lấy single-run nhanh nhất làm số liệu; công bố phân tán và n.
7. Đối với batch: đưa ra cả tổng throughput và latency từng request.
8. Tránh đo khi model bị swap/OOM/thermal throttling hoặc có job GPU khác.
9. Không chạy 'insecure install | sh' chỉ để benchmark; audit source/binary.
10. Giữ full raw JSON, command line, logs và commit cho người khác tái lập.

## Đọc thêm

- [llama-bench upstream](https://github.com/ggml-org/llama.cpp/tree/master/tools/llama-bench)
- [llama-server speed benchmark](https://github.com/ggml-org/llama.cpp/tree/master/tools/server/bench/speed-bench)
- [Inside vLLM: Anatomy](https://vllm.ai/blog/2025-09-05-anatomy-of-vllm)
- [EAGLE-3 paper](https://arxiv.org/abs/2503.01840)
