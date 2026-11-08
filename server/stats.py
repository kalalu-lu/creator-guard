from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any

from . import db
from .classifier import summarize_suggestions
from .config import settings

logger = logging.getLogger("creator_guard.stats")

CATEGORY_LABELS = {
    "suggestion": "有效建议",
    "praise": "正向夸奖",
    "question": "提问",
    "negative": "普通负评",
    "malicious": "恶意攻击",
    "spam": "广告引流",
    "off_topic": "无关/无意义",
    "neutral": "中性",
}


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _dedupe_suggestions(items: list[str], limit: int = 5) -> list[str]:
    out: list[str] = []
    for raw in items:
        text = (raw or "").strip()
        if not text:
            continue
        if any(SequenceMatcher(None, text, existing).ratio() >= 0.86 for existing in out):
            continue
        out.append(text[:160])
        if len(out) >= limit:
            break
    return out


def _headline(total: int, top_stance: dict[str, Any] | None) -> str:
    if total <= 0:
        return "还没有收集到评论"
    if total < 5:
        return f"评论还太少（{total} 条），继续收集后再统计"
    if not top_stance:
        return f"已分析 {total} 条评论"
    return f"{top_stance['pct']}% 的评论集中在「{top_stance['label']}」（基于 {total} 条评论）"


async def compute_stats(
    *,
    platform: str,
    thread_id: str,
    thread_title: str | None,
    days: int | None = None,
) -> dict[str, Any]:
    days = days or settings.stats_window_days
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=days)
    comments = db.get_comments(platform, thread_id, days)
    total = len(comments)

    category_counter = Counter(c["category"] for c in comments)
    stance_counter = Counter(c["stance"] for c in comments)
    suggestions = [
        c["suggestion"]
        for c in comments
        if c.get("is_actionable_suggestion") and c.get("suggestion")
    ]
    top_suggestions = _dedupe_suggestions(suggestions, limit=5)

    bars = []
    for label, count in stance_counter.most_common():
        bars.append(
            {
                "label": label,
                "count": count,
                "pct": round(count / total * 100) if total else 0,
            }
        )
    top_stance = bars[0] if bars else None

    suggestion_summary = await summarize_suggestions(top_suggestions) if top_suggestions else ""
    generated_at = _iso(now)
    next_refresh_at = _iso(now + timedelta(days=days))

    payload: dict[str, Any] = {
        "platform": platform,
        "thread_id": thread_id,
        "thread_title": thread_title,
        "window_days": days,
        "window_start": _iso(window_start),
        "window_end": generated_at,
        "total": total,
        "category_counts": {CATEGORY_LABELS.get(k, k): v for k, v in category_counter.items()},
        "category_counts_raw": dict(category_counter),
        "stance_counts": dict(stance_counter),
        "bars": bars,
        "top_stance": top_stance,
        "headline": _headline(total, top_stance),
        "suggestion_summary": suggestion_summary,
        "top_suggestions": top_suggestions,
        "generated_at": generated_at,
        "next_refresh_at": next_refresh_at,
    }
    return payload


async def refresh_stats(
    *,
    platform: str,
    thread_id: str,
    thread_title: str | None = None,
    force: bool = True,
) -> dict[str, Any]:
    payload = await compute_stats(
        platform=platform,
        thread_id=thread_id,
        thread_title=thread_title,
    )
    if payload["total"] > 0:
        db.save_thread_stats(
            platform=platform,
            thread_id=thread_id,
            window_days=payload["window_days"],
            window_start=payload["window_start"],
            window_end=payload["window_end"],
            total=payload["total"],
            payload=payload,
        )
    payload["cached"] = False
    payload["new_comments"] = 0
    return payload


async def get_stats(
    *,
    platform: str,
    thread_id: str,
    thread_title: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    latest = db.get_latest_stats(platform, thread_id)
    if latest and not force:
        created = db.parse_iso(latest["created_at"])
        age = datetime.now(timezone.utc) - created
        if age < timedelta(days=settings.stats_window_days):
            payload = dict(latest["payload"])
            payload["cached"] = True
            # Use the snapshot's total instead of a timestamp comparison:
            # several comments can be inserted within the same second.
            payload["new_comments"] = max(
                0,
                db.count_comments(platform, thread_id) - int(latest["total"]),
            )
            payload["snapshot_at"] = latest["created_at"]
            return payload

    return await refresh_stats(
        platform=platform,
        thread_id=thread_id,
        thread_title=thread_title,
        force=True,
    )


def threads_needing_refresh() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for thread in db.list_threads_with_comments():
        latest = db.get_latest_stats(thread["platform"], thread["thread_id"])
        if not latest:
            out.append(thread)
            continue
        created = db.parse_iso(latest["created_at"])
        if datetime.now(timezone.utc) - created >= timedelta(days=settings.stats_window_days):
            if db.count_comments(thread["platform"], thread["thread_id"]) > int(latest["total"]):
                out.append(thread)
    return out


async def refresh_due_threads() -> int:
    count = 0
    for thread in threads_needing_refresh():
        try:
            await refresh_stats(
                platform=thread["platform"],
                thread_id=thread["thread_id"],
                thread_title=thread.get("thread_title"),
                force=True,
            )
            count += 1
        except Exception:  # noqa: BLE001
            logger.exception("Failed to refresh stats for %s/%s", thread["platform"], thread["thread_id"])
    return count
