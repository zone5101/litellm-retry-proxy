#!/usr/bin/env python3
"""Compare *real* llama-bench JSON reports without inventing benchmark results.

Usage:
    python3 compare_llama_bench.py baseline.json candidate.json
    python3 compare_llama_bench.py baseline.json fa_on.json --json-out results.json

Reads llama-bench '-o json' arrays. Match on n_prompt, n_gen, n_depth,
and insist on hardware/model/build parity (unless explicitly overridden).
Only one benchmark configuration per test key per file is accepted.
No dependencies beyond Python stdlib.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


def load_report(path: str) -> dict[tuple[int, int, int], dict]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"{path}: expected JSON array from llama-bench -o json")
    result = {}
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"{path}: item {i} is not a JSON object")
        try:
            key = tuple(int(item.get(k, 0) or 0) for k in ("n_prompt", "n_gen", "n_depth"))
            value = float(item["avg_ts"])
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(f"{path}: invalid benchmark row {i}: {exc}") from exc
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f"{path}: invalid avg_ts at row {i}: {value}")
        if key in result:
            raise ValueError(
                f"{path}: repeated test {key}; isolate each configuration into its own JSON file"
            )
        result[key] = item
    return result


def test_name(key: tuple[int, int, int]) -> str:
    pp, tg, depth = key
    phase = "PP" if pp and not tg else "TG" if tg and not pp else "PP+TG"
    return f"{phase}(pp={pp},tg={tg},depth={depth})"


def check_same(
    name: str,
    base: dict,
    cand: dict,
    *,
    allow_model_change: bool,
    allow_build_change: bool,
) -> None:
    stable_fields = ["cpu_info", "gpu_info", "backends"]
    if not allow_model_change:
        stable_fields.extend(("model_filename", "model_type", "model_n_params"))
    if not allow_build_change:
        stable_fields.append("build_commit")
    for field in stable_fields:
        a, b = base.get(field), cand.get(field)
        if a != b:
            raise ValueError(
                f"{name}: {field} mismatch ({a!r} vs {b!r}). "
                f"Refuse unfair comparison; use an explicit --allow-... flag only if intended."
            )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("baseline", help="llama-bench -o json baseline result")
    p.add_argument("candidate", help="llama-bench -o json candidate result")
    p.add_argument("--allow-model-change", action="store_true", help="needed for quant comparisons; separately score quality")
    p.add_argument("--allow-build-change", action="store_true", help="advanced: engine versions differ, interpret with caution")
    p.add_argument("--json-out", type=Path, help="save a summary JSON; does not overwrite input reports")
    args = p.parse_args()

    base, cand = load_report(args.baseline), load_report(args.candidate)
    common = sorted(set(base) & set(cand))
    if not common:
        print("No matching PP/TG/context-depth test keys.", file=sys.stderr)
        return 1
    output = []
    print(f"{'Test':<35} {'Base t/s':>12} {'New t/s':>12} {'Ratio':>10} {'Delta':>10}")
    print("-" * 82)
    for key in common:
        a, b = base[key], cand[key]
        name = test_name(key)
        check_same(name, a, b,
                   allow_model_change=args.allow_model_change,
                   allow_build_change=args.allow_build_change)
        old = float(a["avg_ts"])
        new = float(b["avg_ts"])
        ratio = new / old
        delta = (ratio - 1.0) * 100.0
        print(f"{name:<35} {old:>12.2f} {new:>12.2f} {ratio:>9.2f}x {delta:>+9.1f}%")
        output.append({
            "test": name, "n_prompt": key[0], "n_gen": key[1], "n_depth": key[2],
            "baseline_tokens_per_second": old,
            "candidate_tokens_per_second": new,
            "speedup_ratio": ratio, "delta_percent": delta,
            "baseline_stddev_ts": a.get("stddev_ts"),
            "candidate_stddev_ts": b.get("stddev_ts"),
        })
    missing = sorted((set(base) ^ set(cand)))
    if missing:
        print(f"Note: {len(missing)} unmatched tests excluded.")
    print("Warning: ratios are descriptive, NOT statistically significant claims.")
    print("llama-bench excludes end-to-end tokenization/sampling/network latency.")
    if args.allow_model_change:
        print("WARNING: model/quant changed; quality parity is NOT established.")
    if args.allow_build_change:
        print("WARNING: build changed; runtime parity is NOT established.")
    if args.json_out:
        args.json_out.write_text(json.dumps({
            "baseline": args.baseline, "candidate": args.candidate,
            "comparisons": output,
            "warning": "Descriptive only; not an end-to-end or quality benchmark.",
        }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Saved {args.json_out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
