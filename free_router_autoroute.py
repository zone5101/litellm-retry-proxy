# free_router_autoroute.py - auto-route hook cho LiteLLM free-router
# (ASCII khong dau - vi loi cp1252, xem MAINTENANCE 11.6)
#
# User chi chon DUY NHAT model "agent-auto" trong Copilot picker. Hook nay chay truoc moi
# request, phan loai theo context roi doi data['model'] sang chuoi phu hop:
#   agent-omni   : co anh/audio/video trong message (da phuong tien) -> vision-only chain
#   agent-strong  : input dai (>30k token uoc tinh), hoac agentic sau (tool + >12k token
#                   hoac >24 msg hoac >6 tool-result), hoac reasoning_effort=high
#   free-small    : request nho: khong tool, <=4 msg, <1500 token, max_tokens<=800
#                   (utility: chat title, commit message, tom tat nho - tiet kiem credits)
#   agent-fast    : con lai (mac dinh cho viec hang ngay)
# Sau khi doi model, LiteLLM router van lo tiep: order-failover, cooldown 429,
# context_window_fallbacks - nguyen ven trong chuoi da chon.
#
# Mount trong free-router.config.yaml:
#   litellm_settings:
#     callbacks: free_router_autoroute.autorouter

from litellm.integrations.custom_logger import CustomLogger
import litellm

MEDIA_TYPES = ("image_url", "input_audio", "audio_url", "video_url", "image", "file")

# Nguong (deu nam o day de tinh chinh nhanh):
STRONG_INPUT_TOKENS = 30000
STRONG_AGENTIC_TOKENS = 12000
STRONG_MAX_MSGS = 24
STRONG_TOOL_RESULTS = 6
SMALL_MAX_TOKENS = 800
SMALL_INPUT_TOKENS = 1500
SMALL_MAX_MSGS = 4
CHARS_PER_TOKEN = 3.0  # uoc thap con hon uoc cao (bao toan cho tieng Viet)


def _scan(content):
    """Tra ve (so ky tu, co media khong). Content co the la str hoac list cac part."""
    if isinstance(content, str):
        return len(content), False
    if isinstance(content, list):
        total, media = 0, False
        for part in content:
            if isinstance(part, dict):
                t = part.get("type") or ""
                if t in MEDIA_TYPES:
                    media = True
                txt = part.get("text")
                if isinstance(txt, str):
                    total += len(txt)
                elif t not in MEDIA_TYPES:
                    total += len(str(part))
            else:
                total += len(str(part))
        return total, media
    return len(str(content)), False


class AutoRouter(CustomLogger):
    """Phan loai request cho agent-auto. Cac model khac: khong dam phan."""

    async def async_pre_call_hook(self, *args, **kwargs):
        # Tim data dict - chiu dung ca chu ky cu (3 tham so) va moi (4 tham so co cache)
        data = None
        for a in args:
            if isinstance(a, dict) and "model" in a:
                data = a
                break
        if data is None:
            data = kwargs.get("data")
        if not isinstance(data, dict):
            return args[-1] if args else None

        try:
            if data.get("model") != "agent-auto":
                return data  # 4 chuoi chon truc tiep: khong can thiep

            messages = data.get("messages") or []
            tools = data.get("tools") or []
            max_tokens = data.get("max_tokens") or 0
            effort = str(data.get("reasoning_effort") or "").lower()

            total_chars, media = 0, False
            tool_results = 0
            for m in messages:
                if not isinstance(m, dict):
                    continue
                c, has_media = _scan(m.get("content"))
                total_chars += c
                media = media or has_media
                if m.get("role") == "tool":
                    tool_results += 1

            est_tokens = int(total_chars / CHARS_PER_TOKEN)
            n_msgs = len(messages)

            target, reason = "agent-fast", "default"
            if media:
                target, reason = "agent-omni", "multimodal"
                # Vision request: ensure we use vision-only chain (agent-omni)
                print("[auto-route] Vision request -> using agent-omni (vision-only chain)", flush=True)
            elif effort == "high":
                target, reason = "agent-strong", "effort-high"
            elif est_tokens > STRONG_INPUT_TOKENS:
                target, reason = "agent-strong", "input-" + str(est_tokens) + "tok"
            elif tools and (est_tokens > STRONG_AGENTIC_TOKENS or n_msgs > STRONG_MAX_MSGS or tool_results > STRONG_TOOL_RESULTS):
                target, reason = "agent-strong", "agentic-deep"
            elif (not tools) and n_msgs <= SMALL_MAX_MSGS and est_tokens < SMALL_INPUT_TOKENS and 0 < max_tokens <= SMALL_MAX_TOKENS:
                target, reason = "free-small", "utility-small"

            print("[auto-route] agent-auto -> %s (%s) est_tok=%d msgs=%d tools=%d tool_res=%d max_tok=%s effort=%s" % (
                target, reason, est_tokens, n_msgs, len(tools), tool_results, max_tokens, effort), flush=True)
            data["model"] = target
        except Exception as e:
            # Hook loi: giu nguyen model (agent-auto co chuoi du phong rieng trong config)
            print("[auto-route] LOI hook, de agent-auto chain xu ly: " + repr(e), flush=True)
        return data


autorouter = AutoRouter()
