#!/usr/bin/env python
"""Backend smoke checks for NNovel writing-quality phases.

This script validates a subset of non-UI behavior introduced by the
writing-quality optimization plan.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from codex_engine import _build_chapter_progress_block, _build_no_repeat_tail_block, _parse_word_target
from data_store import _normalize_project_cache


def _check(name: str, condition: bool, detail: str = "") -> bool:
    if condition:
        print(f"[PASS] {name}")
        return True
    print(f"[FAIL] {name}: {detail}")
    return False


def main() -> int:
    ok = True

    wmin, target, wmax = _parse_word_target("3000字")
    ok &= _check("word_target single value", (wmin, target, wmax) == (2700, 3000, 3300), f"got {(wmin, target, wmax)}")

    wmin2, target2, wmax2 = _parse_word_target("2000-3000字")
    ok &= _check("word_target range uses upper bound", (wmin2, target2, wmax2) == (2700, 3000, 3300), f"got {(wmin2, target2, wmax2)}")


    wmin3, target3, wmax3 = _parse_word_target("2000字")
    ok &= _check("word_target low value uses 2500 floor", (wmin3, target3, wmax3) == (2250, 2500, 2750), f"got {(wmin3, target3, wmax3)}")
    p1 = _build_chapter_progress_block(1)
    p2 = _build_chapter_progress_block(2)
    ok &= _check("chapter progress hidden for chapter 1", p1 == "", f"got {p1!r}")
    ok &= _check("chapter progress shown for chapter 2", "第2章" in p2 and "已完成1章" in p2, f"got {p2!r}")

    tail = _build_no_repeat_tail_block("A" * 1200, limit=900)
    ok &= _check("no-repeat tail block format", tail.startswith("【禁止重复片段】\n"), f"got {tail[:40]!r}")
    ok &= _check("no-repeat tail block length", len(tail) <= 950, f"len={len(tail)}")

    cache_from_str = _normalize_project_cache("legacy-cache")
    ok &= _check(
        "cache normalize from legacy string",
        cache_from_str == {"summary": "legacy-cache", "context_pack": "", "updated_at": ""},
        f"got {cache_from_str}",
    )

    cache_from_dict = _normalize_project_cache({"summary": "s", "context_pack": "c", "updated_at": "t"})
    ok &= _check(
        "cache normalize from dict",
        cache_from_dict == {"summary": "s", "context_pack": "c", "updated_at": "t"},
        f"got {cache_from_dict}",
    )

    if ok:
        print("\nAll backend smoke checks passed.")
        return 0

    print("\nBackend smoke checks failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())


