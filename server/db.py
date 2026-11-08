from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

from .config import settings

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    conversation_name TEXT,
    content_hash TEXT NOT NULL,
    preview TEXT,
    text TEXT NOT NULL,
    category TEXT NOT NULL,
    severity INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    reason TEXT,
    action TEXT,
    hide_preview INTEGER NOT NULL DEFAULT 0,
    evidence_json TEXT,
    source TEXT NOT NULL DEFAULT 'llm',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (platform, conversation_key, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_dm_key
    ON dm_messages (platform, conversation_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    thread_title TEXT,
    comment_id TEXT NOT NULL,
    text TEXT NOT NULL,
    category TEXT NOT NULL,
    stance TEXT NOT NULL,
    topic TEXT,
    is_actionable_suggestion INTEGER NOT NULL DEFAULT 0,
    suggestion TEXT,
    reason TEXT,
    source TEXT NOT NULL DEFAULT 'llm',
    created_at TEXT NOT NULL,
    UNIQUE (platform, thread_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_comments_thread
    ON comments (platform, thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS thread_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    window_days INTEGER NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    total INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stats_thread
    ON thread_stats (platform, thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    original_category TEXT,
    corrected_category TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(settings.db_path), timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def log(action: str, detail: str | None = None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO audit_log (action, detail, created_at) VALUES (?, ?, ?)",
            (action, detail, now_iso()),
        )


def upsert_dm(result: dict[str, Any]) -> None:
    now = now_iso()
    evidence = json.dumps(result.get("evidence") or [], ensure_ascii=False)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO dm_messages (
                platform, conversation_key, conversation_name, content_hash,
                preview, text, category, severity, confidence, reason, action,
                hide_preview, evidence_json, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(platform, conversation_key, content_hash) DO UPDATE SET
                conversation_name = excluded.conversation_name,
                preview = excluded.preview,
                text = excluded.text,
                category = excluded.category,
                severity = excluded.severity,
                confidence = excluded.confidence,
                reason = excluded.reason,
                action = excluded.action,
                hide_preview = excluded.hide_preview,
                evidence_json = excluded.evidence_json,
                source = excluded.source,
                updated_at = excluded.updated_at
            """,
            (
                result["platform"],
                result["conversation_key"],
                result.get("conversation_name"),
                result["content_hash"],
                result.get("preview"),
                result["text"],
                result["category"],
                int(result.get("severity", 0)),
                float(result.get("confidence", 0)),
                result.get("reason", ""),
                result.get("action", ""),
                1 if result.get("hide_preview") else 0,
                evidence,
                result.get("source", "llm"),
                now,
                now,
            ),
        )


def get_dm_annotation(platform: str, conversation_key: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM dm_messages
            WHERE platform = ? AND conversation_key = ?
            ORDER BY updated_at DESC LIMIT 1
            """,
            (platform, conversation_key),
        ).fetchone()
    return dict(row) if row else None


def get_dm_annotations(platform: str, keys: Iterable[str]) -> dict[str, dict[str, Any]]:
    keys = [k for k in keys if k]
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM dm_messages
            WHERE platform = ? AND conversation_key IN ({placeholders})
            ORDER BY updated_at DESC
            """,
            (platform, *keys),
        ).fetchall()
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        item = dict(row)
        out.setdefault(item["conversation_key"], item)
    return out


def upsert_comment(result: dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO comments (
                platform, thread_id, thread_title, comment_id, text, category,
                stance, topic, is_actionable_suggestion, suggestion, reason,
                source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(platform, thread_id, comment_id) DO UPDATE SET
                text = excluded.text,
                category = excluded.category,
                stance = excluded.stance,
                topic = excluded.topic,
                is_actionable_suggestion = excluded.is_actionable_suggestion,
                suggestion = excluded.suggestion,
                reason = excluded.reason,
                source = excluded.source
            """,
            (
                result["platform"],
                result["thread_id"],
                result.get("thread_title"),
                result["comment_id"],
                result["text"],
                result["category"],
                result["stance"],
                result.get("topic", ""),
                1 if result.get("is_actionable_suggestion") else 0,
                result.get("suggestion") or "",
                result.get("reason", ""),
                result.get("source", "llm"),
                now_iso(),
            ),
        )


def get_comments(platform: str, thread_id: str, days: int | None = None) -> list[dict[str, Any]]:
    """All stored comments for a thread.

    The 5-day value is the *stats refresh cadence*, not a filter on comment age.
    Old comments should stay in the denominator; otherwise a snapshot would
    silently drop comments just because they were collected more than 5 days ago.
    """
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM comments
            WHERE platform = ? AND thread_id = ?
            ORDER BY created_at DESC
            """,
            (platform, thread_id),
        ).fetchall()
    return [dict(r) for r in rows]


def count_comments(platform: str, thread_id: str) -> int:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS n FROM comments
            WHERE platform = ? AND thread_id = ?
            """,
            (platform, thread_id),
        ).fetchone()
    return int(row["n"]) if row else 0


def save_thread_stats(
    *,
    platform: str,
    thread_id: str,
    window_days: int,
    window_start: str,
    window_end: str,
    total: int,
    payload: dict[str, Any],
) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO thread_stats (
                platform, thread_id, window_days, window_start, window_end,
                total, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                platform,
                thread_id,
                window_days,
                window_start,
                window_end,
                total,
                json.dumps(payload, ensure_ascii=False),
                now_iso(),
            ),
        )


def get_latest_stats(platform: str, thread_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM thread_stats
            WHERE platform = ? AND thread_id = ?
            ORDER BY created_at DESC LIMIT 1
            """,
            (platform, thread_id),
        ).fetchone()
    if not row:
        return None
    item = dict(row)
    item["payload"] = json.loads(item.pop("payload_json"))
    return item


def list_threads_with_comments() -> list[dict[str, str]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT platform, thread_id, MAX(thread_title) AS thread_title
            FROM comments
            GROUP BY platform, thread_id
            """
        ).fetchall()
    return [dict(r) for r in rows]


def add_feedback(
    *,
    target_type: str,
    target_id: str,
    original_category: str | None,
    corrected_category: str,
    note: str | None = None,
) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO feedback (
                target_type, target_id, original_category, corrected_category, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (target_type, target_id, original_category, corrected_category, note, now_iso()),
        )


def purge_old(retention_days: int) -> tuple[int, int]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat(timespec="seconds").replace("+00:00", "Z")
    with connect() as conn:
        dm = conn.execute("DELETE FROM dm_messages WHERE updated_at < ?", (cutoff,)).rowcount
        cm = conn.execute("DELETE FROM comments WHERE created_at < ?", (cutoff,)).rowcount
        conn.execute("DELETE FROM audit_log WHERE created_at < ?", (cutoff,))
    return int(dm), int(cm)


def delete_all() -> None:
    with connect() as conn:
        for table in ("dm_messages", "comments", "thread_stats", "feedback", "audit_log"):
            conn.execute(f"DELETE FROM {table}")


def export_all() -> dict[str, Any]:
    data: dict[str, Any] = {}
    with connect() as conn:
        for table in ("dm_messages", "comments", "thread_stats", "feedback"):
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            data[table] = [dict(r) for r in rows]
    return data


def db_path() -> Path:
    return settings.db_path
