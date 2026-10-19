"""
evaluate_benchmarks.py
Secure Eldercare — Unified ML Benchmark Evaluation CLI

Usage:
    python evaluate_benchmarks.py [--module {anomaly,face,activity,all}]
                                  [--dataset <root>]
                                  [--output  <dir>]
                                  [--demo]
                                  [--k-folds <int>]
                                  [--device  {cpu,cuda}]

Module-specific dataset overrides:
    python evaluate_benchmarks.py --module anomaly  --dataset datasets/fall_detection/
    python evaluate_benchmarks.py --module face     --dataset datasets/face/lfw/
    python evaluate_benchmarks.py --module skeleton --dataset datasets/skeleton_reid/
    python evaluate_benchmarks.py --module activity --dataset datasets/activity_recognition/
    python evaluate_benchmarks.py --module all      --demo        # No download needed

Outputs (written to <output>/):
    reports/anomaly_confusion_matrix.png
    reports/anomaly_roc_curve.png
    reports/face_fnmr_fmr.png
    reports/face_confusion_matrix.png
    reports/skeleton_confusion_matrix.png
    reports/activity_confusion_matrix.png
    reports/benchmark_results.tex        ← IEEE LaTeX table
    reports/benchmark_results.json       ← Raw results (JSON)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure UTF-8 output on Windows to avoid cp1252 encoding errors
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ── Add project root to path for module imports ───────────────────────────────
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


# ─────────────────────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="evaluate_benchmarks",
        description="Secure Eldercare — ML Benchmark Evaluation Suite",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--module", "-m",
        choices=["anomaly", "face", "skeleton", "activity", "all"],
        default="all",
        help="Which module to benchmark (default: all).",
    )
    p.add_argument(
        "--dataset", "-d",
        default=None,
        metavar="PATH",
        help="Root path to the benchmark dataset directory.",
    )
    p.add_argument(
        "--face-dataset",
        default=None,
        metavar="PATH",
        help="Root path to face dataset (overrides --dataset for face module).",
    )
    p.add_argument(
        "--skeleton-dataset",
        default=None,
        metavar="PATH",
        help="Root path to skeleton-ReID dataset (overrides --dataset for skeleton module).",
    )
    p.add_argument(
        "--output", "-o",
        default="reports",
        metavar="DIR",
        help="Output directory for plots, LaTeX, and JSON (default: reports/).",
    )
    p.add_argument(
        "--demo",
        action="store_true",
        help="Use synthetic demo data — no dataset download needed.",
    )
    p.add_argument(
        "--k-folds", "-k",
        type=int,
        default=5,
        metavar="K",
        help="Number of stratified k-fold splits (default: 5). Use 1 for 70/15/15 split.",
    )
    p.add_argument(
        "--device",
        choices=["cpu", "cuda"],
        default="cpu",
        help="PyTorch device for deep learning inference (default: cpu).",
    )
    return p


# ─────────────────────────────────────────────────────────────────────────────
#  Runner
# ─────────────────────────────────────────────────────────────────────────────

def run(args: argparse.Namespace) -> None:
    from benchmarks.utils import (
        build_latex_table,
        append_latex_results,
        save_json,
        print_terminal_table,
    )

    output_dir = args.output
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    all_results: List[Dict[str, Any]] = []
    wall_start  = time.perf_counter()

    # ── Module 1: Fall & Anomaly Detection ───────────────────────────────────
    if args.module in ("anomaly", "all"):
        from benchmarks.anomaly_detection_eval import evaluate as eval_anomaly
        dataset_name = "URFD / Le2i" if not args.demo else "URFD / Le2i (demo)"
        rows = eval_anomaly(
            root_dir     = args.dataset,
            output_dir   = output_dir,
            k_folds      = args.k_folds,
            demo_mode    = args.demo or args.dataset is None,
            dataset_name = dataset_name,
        )
        all_results.extend(rows)

    # ── Module 2a: Face Verification ─────────────────────────────────────────
    if args.module in ("face", "all"):
        from benchmarks.face_skeleton_id_eval import evaluate_face
        face_dir     = args.face_dataset or args.dataset
        dataset_name = "LFW" if not args.demo else "LFW (demo)"
        rows = evaluate_face(
            root_dir     = face_dir,
            output_dir   = output_dir,
            demo_mode    = args.demo or face_dir is None,
            device       = args.device,
            dataset_name = dataset_name,
        )
        all_results.extend(rows)

    # ── Module 2b: Skeleton Identification ───────────────────────────────────
    if args.module in ("skeleton", "all"):
        from benchmarks.face_skeleton_id_eval import evaluate_skeleton
        skel_dir     = args.skeleton_dataset or args.dataset
        dataset_name = "Kinect-ReID" if not args.demo else "Kinect-ReID (demo)"
        rows = evaluate_skeleton(
            root_dir     = skel_dir,
            output_dir   = output_dir,
            k_folds      = args.k_folds,
            demo_mode    = args.demo or skel_dir is None,
            dataset_name = dataset_name,
        )
        all_results.extend(rows)

    # ── Module 3: Activity Recognition ───────────────────────────────────────
    if args.module in ("activity", "all"):
        from benchmarks.activity_recognition_eval import evaluate as eval_activity
        dataset_name = "Custom ADL / Kinetics" if not args.demo else "Custom ADL (demo)"
        rows = eval_activity(
            root_dir     = args.dataset,
            output_dir   = output_dir,
            k_folds      = args.k_folds,
            demo_mode    = args.demo or args.dataset is None,
            dataset_name = dataset_name,
            device       = args.device,
        )
        all_results.extend(rows)

    # ── Aggregate summary table ───────────────────────────────────────────────
    wall_elapsed = time.perf_counter() - wall_start
    print(f"\n{'═'*65}")
    print(f"  BENCHMARK COMPLETE — {len(all_results)} result rows  "
          f"({wall_elapsed:.1f}s total)")
    print(f"{'═'*65}")

    if all_results:
        summary_rows = [
            [
                r["dataset"],
                r["module"],
                r["task"],
                f"{r['accuracy']*100:.2f}",
                f"{r['precision']*100:.2f}",
                f"{r['recall']*100:.2f}",
                f"{r['f1_score']*100:.2f}",
                f"{r['fps']:.1f}",
            ]
            for r in all_results
        ]
        print_terminal_table(
            headers=["Dataset", "Module", "Task",
                     "Acc%", "Prec%", "Rec%", "F1%", "FPS"],
            rows=summary_rows,
            title="IEEE Paper — Benchmark Results Summary",
        )

        # LaTeX
        latex_str = build_latex_table(all_results)
        append_latex_results(latex_str, output_dir)

        # JSON
        save_json(
            {
                "results":      all_results,
                "total_rows":   len(all_results),
                "elapsed_sec":  round(wall_elapsed, 2),
                "demo_mode":    args.demo,
                "k_folds":      args.k_folds,
            },
            path=str(Path(output_dir) / "benchmark_results.json"),
        )

        # Print LaTeX snippet to terminal
        print(f"\n{'─'*65}")
        print("  LaTeX Snippet (IEEE format) — copy into your paper:\n")
        print(latex_str)
        print(f"{'─'*65}\n")

    else:
        print("  [WARN] No results collected — check dataset paths or use --demo.")


# ─────────────────────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    print(
        "\n+" + "=" * 66 + "+\n"
        "| Secure Eldercare -- ML Benchmark Evaluation Suite v1.0         |\n"
        "| Modules: Anomaly Detection / Face+Skeleton ID / ADL            |\n"
        "+" + "=" * 66 + "+\n"
    )
    parser = _build_parser()
    args   = parser.parse_args()

    if args.demo:
        print("  [INFO] Running in DEMO mode — all data is synthetic.\n")
    elif args.dataset is None and args.module == "all":
        print("  [INFO] No --dataset path given — auto-enabling --demo mode.\n")
        args.demo = True

    try:
        run(args)
    except KeyboardInterrupt:
        print("\n  [INTERRUPTED] Benchmark cancelled by user.")
        sys.exit(1)
    except Exception as exc:
        print(f"\n  [ERROR] Benchmark failed: {exc}")
        import traceback
        traceback.print_exc()
        sys.exit(2)


if __name__ == "__main__":
    main()
