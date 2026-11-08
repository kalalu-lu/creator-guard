from __future__ import annotations

import json
import logging
from typing import Any

from . import rules
from .config import settings
from .llm import LLMError, ollama_chat_json
from .models import CommentItem, DmClassifyRequest
from .prompts import (
    COMMENT_SYSTEM,
    COMMENT_USER_TEMPLATE,
    DM_SYSTEM,
    DM_USER_TEMPLATE,
    SUMMARY_SYSTEM,
    SUMMARY_USER_TEMPLATE,
)

logger = logging.getLogger("creator_guard.classifier")


def _clamp_float(value: Any, default: float = 0.0) -> float:
    try:
        return round(max(0.0, min(1.0, float(value))), 3)
    except (TypeError, ValueError):
        return default


def _safe_str(value: Any, limit: int = 200) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _safe_evidence(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value[:3]:
        if isinstance(item, str) and item.strip():
            out.append(item.strip()[:80])
    return out


def _merge_dm(rule_result: dict[str, Any], llm_result: dict[str, Any]) -> dict[str, Any]:
    """规则层负责兜底；模型判 normal 时，强规则命中仍然保留。"""
    llm_category = llm_result.get("category")
    if llm_category not in rules.DM_CATEGORIES:
        return rule_result

    if (
        llm_category == "normal"
        and rule_result["category"] in {"illegal", "malicious", "collab"}
        and rule_result["confidence"] >= 0.7
    ):
        return rule_result

    category = llm_category
    hide_preview = category in {"illegal", "malicious"}
    return {
        "category": category,
        "severity": int(llm_result.get("severity") or {"illegal": 3, "malicious": 2, "collab": 1, "spam": 1}.get(category, 0)),
        "confidence": _clamp_float(llm_result.get("confidence"), 0.6),
        "reason": _safe_str(llm_result.get("reason"), 80) or rule_result.get("reason", ""),
        "action": rules.DM_ACTION[category],
        "hide_preview": hide_preview,
        "evidence": _safe_evidence(llm_result.get("evidence")) or rule_result.get("evidence", []),
        "source": "llm+rules",
    }


async def classify_dm(req: DmClassifyRequest) -> dict[str, Any]:
    text = req.text[: settings.max_dm_chars]
    rule_result = rules.rule_dm(text)

    if settings.llm_backend == "mock":
        return {**rule_result, "degraded": False, "error": None}

    try:
        raw = await ollama_chat_json(
            DM_SYSTEM,
            DM_USER_TEMPLATE.format(platform=req.platform, text=text),
        )
        if not isinstance(raw, dict):
            raise LLMError("模型返回的私信结果不是对象")
        merged = _merge_dm(rule_result, raw)
        return {**merged, "degraded": False, "error": None}
    except Exception as exc:  # noqa: BLE001
        logger.warning("DM LLM failed, fallback to rules: %s", exc)
        return {**rule_result, "degraded": True, "error": str(exc)[:300]}


def classify_previews(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """预览快筛只走规则层，保证在页面打开后 1 秒内能标注。

    预览文字通常只有一两行，信息不完整；即使模型参与也容易误判。
    真正的完整判断在点开会话后由 /api/dm/classify 完成。
    """
    results: list[dict[str, Any]] = []
    for item in items:
        result = rules.rule_preview(str(item.get("preview") or ""))
        results.append({"id": item.get("id"), **result})
    return results


def _merge_comment(rule_result: dict[str, Any], llm_result: dict[str, Any]) -> dict[str, Any]:
    category = llm_result.get("category")
    if category not in rules.COMMENT_CATEGORIES:
        return rule_result

    # 规则层抓到明确辱骂时，不允许模型把它洗成普通评论。
    if rule_result["category"] == "malicious" and category != "malicious":
        return rule_result

    stance = llm_result.get("stance")
    if stance not in rules.STANCES:
        stance = rule_result.get("stance", "其他")

    suggestion = _safe_str(llm_result.get("suggestion"), 160)
    is_suggestion = bool(llm_result.get("is_actionable_suggestion")) or category == "suggestion"
    if category == "suggestion" and not suggestion:
        suggestion = rule_result.get("suggestion") or ""

    topic = _safe_str(llm_result.get("topic"), 20) or rule_result.get("topic", "其他")
    if topic not in {x[0] for x in rules.TOPIC_RULES} | {"其他"}:
        topic = "其他"

    return {
        "category": category,
        "stance": stance,
        "topic": topic,
        "is_actionable_suggestion": bool(is_suggestion and suggestion),
        "suggestion": suggestion if is_suggestion else "",
        "confidence": _clamp_float(llm_result.get("confidence"), 0.6),
        "reason": _safe_str(llm_result.get("reason"), 60) or rule_result.get("reason", ""),
        "source": "llm+rules",
    }


async def classify_comments(
    comments: list[CommentItem],
    *,
    thread_title: str | None = None,
) -> tuple[list[dict[str, Any]], bool, str | None]:
    """Return (results, degraded, error)."""
    normalized = [
        {"id": item.id, "text": item.text[: settings.max_comment_chars]}
        for item in comments
    ]
    rule_map = {item["id"]: rules.rule_comment(item["text"]) for item in normalized}

    if settings.llm_backend == "mock":
        return (
            [{"id": item["id"], **rule_map[item["id"]]} for item in normalized],
            False,
            None,
        )

    try:
        payload = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
        raw = await ollama_chat_json(
            COMMENT_SYSTEM,
            COMMENT_USER_TEMPLATE.format(count=len(normalized), payload=payload),
        )
        raw_results = raw.get("results") if isinstance(raw, dict) else raw
        if not isinstance(raw_results, list):
            raise LLMError("模型返回缺少 results 数组")

        llm_map: dict[str, dict[str, Any]] = {}
        for item in raw_results:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                llm_map[item["id"]] = item

        results: list[dict[str, Any]] = []
        for item in normalized:
            llm_result = llm_map.get(item["id"])
            merged = _merge_comment(rule_map[item["id"]], llm_result) if llm_result else rule_map[item["id"]]
            results.append({"id": item["id"], **merged})
        return results, False, None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Comment LLM failed, fallback to rules: %s", exc)
        return (
            [{"id": item["id"], **rule_map[item["id"]]} for item in normalized],
            True,
            str(exc)[:300],
        )


async def summarize_suggestions(suggestions: list[str]) -> str:
    cleaned: list[str] = []
    seen: set[str] = set()
    for suggestion in suggestions:
        text = _safe_str(suggestion, 160)
        key = text.replace(" ", "")
        if text and key not in seen:
            seen.add(key)
            cleaned.append(text)
        if len(cleaned) >= 12:
            break

    if not cleaned:
        return ""
    fallback = "；".join(cleaned[:3])
    if settings.llm_backend == "mock":
        return fallback

    try:
        text = await ollama_chat_json(
            SUMMARY_SYSTEM,
            SUMMARY_USER_TEMPLATE.format(suggestions="\n".join(f"- {s}" for s in cleaned)),
        )
        if isinstance(text, dict):
            text = text.get("summary") or text.get("text") or ""
        if isinstance(text, str) and text.strip():
            return text.strip().strip('"').strip()[:500]
        return fallback
    except Exception as exc:  # noqa: BLE001
        logger.warning("Suggestion summary failed: %s", exc)
        return fallback
