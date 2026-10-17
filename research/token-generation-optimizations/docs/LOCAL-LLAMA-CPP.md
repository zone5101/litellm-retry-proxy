# Tối ưu AI local: Unsloth Desktop + GGUF + llama.cpp

**Đối tượng:** một người dùng máy tính, một mô hình Qwen 27B GGUF (hoặc tương tự), tập trung **decode tokens/s**. Snapshot 2026-10-17.

## Hiểu đúng Unsloth

Mã [unsloth_cli/_inference.py](https://github.com/unslothai/unsloth/blob/main/unsloth_cli/_inference.py#L529-L588) khởi tạo `LlamaCppBackend` cho GGUF. Trải nghiệm Desktop có model hub/UI nhưng tốc độ TG phụ thuộc engine/quant/driver/hardware hơn là claim **fine-tuning 2×** của Unsloth. Dùng bản binary `llama-bench` tương ứng với build llama.cpp gần nhất để khảo sát; nếu binary khác build được đóng gói trong Desktop thì không suy ra hiệu năng Desktop trùng hệt.

## Ưu tiên các phép thử

| Ưu tiên | Kiểm tra | Tác động tiềm năng | Rủi ro |
|---|---|---|---|
| 1 | Có offload phần lớn/tất cả layer lên GPU và **không vượt VRAM**? | TG thường rất rõ | OOM hoặc tràn sang RAM |
| 2 | Chọn quant `Q4_K_M` / `Q5_K_M` so với `IQ1_S` | Có thể nhanh hơn dù model lớn hơn | Model khác độ chính xác, có thể không đủ VRAM |
| 3 | So `--flash-attn on` với `off` | Context dài có lợi; không đảm bảo | Regression theo driver/backend |
| 4 | KV cache `q8_0`, khi cần `q4_0` | Giảm cache memory | Dequant overhead, suy giảm chất lượng |
| 5 | Thử `--threads` quanh physical cores nếu CPU tham gia | Decode CPU path | Quá nhiều thread khiến chậm |
| 6 | Context `-c` vừa đủ | Giảm VRAM giữ cho model GPU-resident | Cắt ngắn prompt dài |
| 7 | N-gram speculation cho sinh code / output lặp | Có thể tăng TG với hit cao | Dự đoán không được chấp nhận làm chậm |
| 8 | Draft/MTP/EAGLE nếu **có draft tương thích** và VRAM dư | Tăng accepted tokens mỗi target pass | Draft overhead, model incompatibility |
| 9 | Multi-GPU split mode | Cứu trường hợp không fit, đôi khi nhanh | PCIe/NVLink overhead |

**Không mặc định** rằng `IQ1_S` nhanh nhất. Chính [llama.cpp feature matrix](https://github.com/ggml-org/llama.cpp/wiki/Feature-matrix) ghi I-quants trên CPU/Metal/Vulkan có thể chậm hơn K-quants cùng mức dung lượng. Đây là lý do nên đo, không đoán.

## Phép đo tái lập (Linux/macOS, đã build llama.cpp)

Dưới đây là ví dụ *không tải mạng, không tự cài gì*, cần `llama-bench` đã có và model GGUF hợp lệ.

```bash
# 1) Baseline PP 512 và TG 128, 5 lần; -o json
./llama-bench -m "/path/to/model.gguf" -p 512 -n 128 -r 5 -o json > baseline.json

# 2) Chỉ thay flash attention; mỗi file giữ thông tin build/hardware
./llama-bench -m "/path/to/model.gguf" -p 512 -n 128 -r 5 -fa off -o json > fa_off.json
./llama-bench -m "/path/to/model.gguf" -p 512 -n 128 -r 5 -fa on  -o json > fa_on.json

# 3) Nếu đủ VRAM, thử KV dtype từng cấu hình
./llama-bench -m "/path/to/model.gguf" -p 512 -n 128 -r 5 -ctk q8_0 -ctv q8_0 -o json > kv_q8.json

# 4) So ở context sâu, khi đủ VRAM
./llama-bench -m "/path/to/model.gguf" -d 4096 -n 128 -r 5 -o json > deep_context.json
```

Tra lệnh/flags `-p`, `-n`, `-r`, `-o json`, `-ctk`, `-ctv`, `-fa` trong [llama-bench upstream](https://github.com/ggml-org/llama.cpp/tree/master/tools/llama-bench). Flags của llama.cpp/Unsloth Desktop **không nhất thiết trùng nhau**; xem `--help` trên *đúng binary* trước khi chạy. Không lấy `llama-bench` của một phiên bản rồi kết luận tuyệt đối về runtime phiên bản khác.

**Lưu ý quan trọng:** chạy `-p 512 -n 128` đo riêng PP và TG; không đồng nghĩa đo TTFT hoặc thời gian cả request. TG từ `llama-bench` cũng không bao gồm toàn bộ tokenization/sampling/network.

## Speculative decoding: chỉ bật khi có lợi

Các engine llama.cpp mới cung cấp `--spec-type` với `draft-simple`, `draft-eagle3`, `draft-mtp`, `ngram-simple`, `ngram-cache`, `draft-dflash`... theo [speculative.md upstream](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md).

Ví dụ server (chỉ khi `llama-server --help` cho phép):

```bash
./llama-server -m "/path/to/model.gguf" --spec-type ngram-simple
```

Cách A/B:

1. Chạy cùng prompt sinh code đủ dài và sample policy, ấm máy như nhau.
2. So **end-to-end output tokens/s**, latency/p50/p95, không chỉ engine TG.
3. Ghi `draft_n`, `draft_n_accepted`, acceptance ratio, VRAM, lượng output.
4. Nếu accepted thấp hoặc draft overhead lớn, tắt ngay.

Dùng `draft-mtp`/EAGLE chỉ khi model có *draft weights/heads tương thích*. **Không giả định Qwen GGUF bất kỳ có MTP**.

## Bẫy cần nhớ

- Khi model quá dung lượng VRAM và offload CPU, bottleneck PCIe có thể khiến giải mã rất chậm.
- `Q4_K_M` và `IQ1_S` là **hai phiên bản xấp xỉ khác nhau**; so tốc độ cần thêm đánh giá code/math/Việt ngữ, không tự coi output ngang nhau.
- Flash attention không đảm bảo nhanh trên tất cả backend: xem các báo cáo regression [CPU ARM](https://github.com/ggml-org/llama.cpp/issues/27086) và [Vulkan](https://github.com/ggml-org/llama.cpp/issues/27137).
- Nếu dùng `llama-server`, đo **TTFT & end-to-end** bởi `llama-bench` không tính sampling/tokenization.
- Trước khi dùng các flag mới, luôn thử `--help` của phiên bản đang chạy; cần kiểm soát context, -ngl, batch, số threads.
- Mức tốc độ phụ thuộc cả chất lượng kernel giải mã quant. Giảm số bit không miễn phí.

## Benchmark chất lượng tối thiểu

Giữ 20–50 câu hỏi: 10 câu code sinh unit tests, 10 câu logic/toán, 10 câu tiếng Việt, 10 câu prompt dài. Chấm tính đúng, compile/test-pass, instruction following; với quant khác nhau đánh giá degradation trước khi chấp nhận speedup.

## Nguồn quan trọng

- [Unsloth GGUF path](https://github.com/unslothai/unsloth/blob/main/unsloth_cli/_inference.py#L529-L588)
- [llama.cpp build/kernels](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)
- [llama.cpp speculative](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md)
- [llama-bench](https://github.com/ggml-org/llama.cpp/tree/master/tools/llama-bench)
- [Backend feature matrix](https://github.com/ggml-org/llama.cpp/wiki/Feature-matrix)
