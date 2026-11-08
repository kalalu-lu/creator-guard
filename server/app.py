from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse

from . import classifier, db, llm, stats
from .config import settings
from .models import (
    CommentClassifyRequest,
    CommentFeedbackRequest,
    DmClassifyRequest,
    DmPreviewRequest,
    text_hash,
)

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("creator_guard")


async def _scheduler_loop() -> None:
    await asyncio.sleep(60)
    while True:
        try:
            if settings.auto_stats:
                changed = await stats.refresh_due_threads()
                if changed:
                    logger.info("Refreshed stats for %s threads", changed)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Stats scheduler failed")
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    removed = db.purge_old(settings.retention_days)
    db.log("server_start", f"purged_dm={removed[0]}, purged_comments={removed[1]}")
    task = asyncio.create_task(_scheduler_loop())
    logger.info("Creator Guard server ready on http://%s:%s", settings.host, settings.port)
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Creator Guard",
    version="0.1.0",
    description="本地运行的 B 站/小红书私信与评论分类服务。所有文本默认只保存在本机。",
    lifespan=lifespan,
)


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    return """<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Creator Guard 本地服务</title>
<style>
body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.7;color:#222}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px}
.ok{color:#067647;font-weight:700}.warn{color:#b42318;font-weight:700}
</style></head>
<body>
<h1>Creator Guard 本地服务已启动</h1>
<p>这是只在本机运行的分类服务。浏览器扩展会把私信/评论发到这里，再由本地 Ollama 判断。</p>
<p>健康检查：<a href="/api/health">/api/health</a></p>
<p>如果浏览器扩展连不上，请确认本窗口没有关闭，地址是 <code>http://127.0.0.1:8765</code>。</p>
<p>数据默认保存在 <code>server/data/creator_guard.db</code>，不会上传到云端。</p>
</body></html>"""


@app.get("/api/health")
async def health() -> dict[str, Any]:
    llm_health = await llm.ollama_health()
    return {
        "ok": True,
        "service": "creator-guard",
        "version": "0.1.0",
        "db": str(db.db_path()),
        "llm": llm_health,
        "config": {
            "stats_window_days": settings.stats_window_days,
            "retention_days": settings.retention_days,
            "auto_stats": settings.auto_stats,
        },
    }


@app.post("/api/dm/preview")
async def dm_preview(req: DmPreviewRequest) -> dict[str, Any]:
    items = [item.model_dump() for item in req.items]
    results = classifier.classify_previews(items)
    return {"results": results}


@app.post("/api/dm/classify")
async def dm_classify(req: DmClassifyRequest) -> dict[str, Any]:
    result = await classifier.classify_dm(req)
    text = req.text[: settings.max_dm_chars]
    record = {
        "platform": req.platform,
        "conversation_key": req.conversation_key,
        "conversation_name": req.conversation_name,
        "content_hash": text_hash(text),
        "preview": (req.preview or "")[:500],
        "text": text,
        **result,
    }
    db.upsert_dm(record)
    return {
        **result,
        "conversation_key": req.conversation_key,
        "content_hash": record["content_hash"],
    }


@app.get("/api/dm/annotations")
async def dm_annotations(
    platform: str = Query(pattern="^(bilibili|xiaohongshu)$"),
    keys: str = Query(default="", max_length=8000),
) -> dict[str, Any]:
    key_list = [k.strip() for k in keys.split(",") if k.strip()][:50]
    rows = db.get_dm_annotations(platform, key_list)
    out: dict[str, Any] = {}
    for key, row in rows.items():
        out[key] = {
            "category": row["category"],
            "severity": row["severity"],
            "confidence": row["confidence"],
            "reason": row["reason"],
            "action": row["action"],
            "label": row["action"],
            "hide_preview": bool(row["hide_preview"]),
            "source": row["source"],
            "updated_at": row["updated_at"],
        }
    return {"annotations": out}


@app.post("/api/comments/classify")
async def comments_classify(req: CommentClassifyRequest) -> dict[str, Any]:
    results, degraded, error = await classifier.classify_comments(
        req.comments,
        thread_title=req.thread_title,
    )
    text_by_id = {item.id: item.text[: settings.max_comment_chars] for item in req.comments}
    for item in results:
        db.upsert_comment(
            {
                "platform": req.platform,
                "thread_id": req.thread_id,
                "thread_title": req.thread_title,
                "comment_id": item["id"],
                "text": text_by_id.get(item["id"], ""),
                **item,
            }
        )
    return {
        "results": results,
        "degraded": degraded,
        "error": error,
        "count": len(results),
    }


@app.get("/api/comments/stats")
async def comments_stats(
    platform: str = Query(pattern="^(bilibili|xiaohongshu)$"),
    thread_id: str = Query(min_length=1, max_length=200),
    thread_title: str | None = Query(default=None, max_length=200),
    force: bool = Query(default=False),
) -> dict[str, Any]:
    return await stats.get_stats(
        platform=platform,
        thread_id=thread_id,
        thread_title=thread_title,
        force=force,
    )


@app.post("/api/comments/stats/refresh")
async def comments_stats_refresh(
    platform: str = Query(pattern="^(bilibili|xiaohongshu)$"),
    thread_id: str = Query(min_length=1, max_length=200),
    thread_title: str | None = Query(default=None, max_length=200),
) -> dict[str, Any]:
    return await stats.refresh_stats(
        platform=platform,
        thread_id=thread_id,
        thread_title=thread_title,
        force=True,
    )


@app.post("/api/feedback")
async def feedback(req: CommentFeedbackRequest) -> dict[str, Any]:
    db.add_feedback(
        target_type=req.target_type,
        target_id=req.target_id,
        original_category=req.original_category,
        corrected_category=req.corrected_category,
        note=req.note,
    )
    return {"ok": True}


@app.get("/api/export")
async def export_data() -> JSONResponse:
    db.log("export")
    return JSONResponse(db.export_all())


@app.delete("/api/data")
async def delete_data(confirm: str = Query(default="")) -> dict[str, Any]:
    if confirm != "DELETE":
        raise HTTPException(status_code=400, detail="请传 confirm=DELETE 明确确认")
    db.delete_all()
    db.log("delete_all")
    return {"ok": True, "message": "本地数据已清空"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)
