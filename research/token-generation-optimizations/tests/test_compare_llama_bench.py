#!/usr/bin/env python3
"""Synthetic unit tests for compare_llama_bench.py — NOT performance measurements."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "compare_llama_bench.py"


def row(*, tps: float, pp: int = 0, tg: int = 128, model: str = "a.gguf",
        build: str = "abcdef", gpu: str = "synthetic gpu") -> dict:
    return {
        "n_prompt": pp, "n_gen": tg, "n_depth": 0,
        "avg_ts": tps, "stddev_ts": 0.5,
        "model_filename": model, "model_type": "synthetic",
        "model_n_params": 7_000_000_000,
        "cpu_info": "synthetic cpu", "gpu_info": gpu,
        "backends": "CUDA", "build_commit": build,
    }


class CompareTests(unittest.TestCase):
    def run_compare(self, left: list[dict], right: list[dict], *args: str):
        with tempfile.TemporaryDirectory() as temp:
            p, q = Path(temp) / "baseline.json", Path(temp) / "candidate.json"
            p.write_text(json.dumps(left), encoding="utf-8")
            q.write_text(json.dumps(right), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(SCRIPT), str(p), str(q), *args],
                capture_output=True, text=True, check=False,
            )

    def test_valid_ratio(self):
        p = self.run_compare([row(tps=20)], [row(tps=30)])
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("1.50x", p.stdout)
        self.assertIn("+50.0%", p.stdout)

    def test_reject_different_models(self):
        p = self.run_compare([row(tps=20)], [row(tps=30, model="b.gguf")])
        self.assertEqual(p.returncode, 2)
        self.assertIn("model_filename mismatch", p.stderr)

    def test_explicitly_allow_quant_comparison(self):
        p = self.run_compare([row(tps=20)], [row(tps=30, model="b.gguf")],
                             "--allow-model-change")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("quality parity", p.stdout)

    def test_reject_different_gpu(self):
        p = self.run_compare([row(tps=20)], [row(tps=30, gpu="other GPU")])
        self.assertEqual(p.returncode, 2)
        self.assertIn("gpu_info mismatch", p.stderr)

    def test_reject_duplicate_benchmark_configuration(self):
        p = self.run_compare([row(tps=20), row(tps=21)], [row(tps=30)])
        self.assertEqual(p.returncode, 2)
        self.assertIn("repeated test", p.stderr)

    def test_multiple_phases(self):
        p = self.run_compare([row(tps=20), row(tps=1000, pp=512, tg=0)],
                             [row(tps=25), row(tps=1100, pp=512, tg=0)])
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("TG(", p.stdout)
        self.assertIn("PP(", p.stdout)

    def test_reject_malformed_input(self):
        p = self.run_compare([{"n_gen":128}], [row(tps=30)])
        self.assertEqual(p.returncode, 2)
        self.assertIn("invalid benchmark row", p.stderr)


if __name__ == "__main__":
    unittest.main()
