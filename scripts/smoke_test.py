"""Local smoke test that does not need Ollama.

Run from the project root:
    .venv\\Scripts\\python.exe scripts\\smoke_test.py
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("CG_LLM_BACKEND", "mock")
os.environ.setdefault("CG_DATA_DIR", tempfile.mkdtemp(prefix="creator-guard-test-"))

from fastapi.testclient import TestClient  # noqa: E402

from server.app import app  # noqa: E402


def main() -> None:
    with TestClient(app) as client:
        health = client.get("/api/health").json()
        assert health["ok"] is True
        assert health["llm"]["backend"] == "mock"

        previews = client.post(
            "/api/dm/preview",
            json={
                "items": [
                    {"id": "bilibili:bad", "preview": "傻逼，滚吧"},
                    {"id": "bilibili:collab", "preview": "品牌方想聊一下商务合作和报价"},
                    {"id": "bilibili:normal", "preview": "这期好好看，学到了"},
                ]
            },
        ).json()["results"]
        by_id = {item["id"]: item for item in previews}
        assert by_id["bilibili:bad"]["category"] == "malicious"
        assert by_id["bilibili:bad"]["hide_preview"] is True
        assert by_id["bilibili:collab"]["category"] == "collab"
        assert by_id["bilibili:normal"]["category"] == "normal"

        dm = client.post(
            "/api/dm/classify",
            json={
                "platform": "bilibili",
                "conversation_key": "bilibili:test-1",
                "conversation_name": "测试用户",
                "preview": "我知道你家地址",
                "text": "我知道你家地址，先给我转5000保证金，不然我就曝光你。",
            },
        ).json()
        assert dm["category"] == "illegal", dm
        assert dm["hide_preview"] is True
        assert dm["action"] == "涉嫌违法行为，建议截图留存"

        annotations = client.get(
            "/api/dm/annotations",
            params={"platform": "bilibili", "keys": "bilibili:test-1"},
        ).json()["annotations"]
        assert "bilibili:test-1" in annotations

        comments = [
            "建议把开头十秒剪短一点，节奏会更紧凑",
            "这期太感人了，看哭了",
            "请问背景音乐是什么？",
            "有点失望，没有上期好看",
            "傻逼博主，去死吧",
            "加微信领资料，日赚300",
            "哈哈哈哈哈",
            "画质很好，我很喜欢",
            "可以把字幕加大一点吗",
            "为什么这一期这么长",
        ]
        classified = client.post(
            "/api/comments/classify",
            json={
                "platform": "bilibili",
                "thread_id": "BV1test",
                "thread_title": "测试视频",
                "comments": [{"id": f"c{i}", "text": text} for i, text in enumerate(comments)],
            },
        ).json()
        assert classified["count"] == len(comments)
        result_by_id = {item["id"]: item for item in classified["results"]}
        assert result_by_id["c0"]["category"] == "suggestion"
        assert result_by_id["c1"]["stance"] == "感动共鸣"
        assert result_by_id["c2"]["category"] == "question"
        assert result_by_id["c3"]["category"] == "negative"
        assert result_by_id["c4"]["category"] == "malicious"
        assert result_by_id["c7"]["category"] == "praise"
        assert result_by_id["c8"]["category"] == "suggestion", result_by_id["c8"]
        assert result_by_id["c9"]["category"] == "question", result_by_id["c9"]

        stats = client.get(
            "/api/comments/stats",
            params={"platform": "bilibili", "thread_id": "BV1test"},
        ).json()
        assert stats["total"] == len(comments)
        assert stats["top_suggestions"]
        assert stats["bars"]
        assert "评论" in stats["headline"]

        # A new comment after the 5-day snapshot should be counted as pending,
        # not silently inserted into the cached snapshot.
        client.post(
            "/api/comments/classify",
            json={
                "platform": "bilibili",
                "thread_id": "BV1test",
                "thread_title": "测试视频",
                "comments": [{"id": "c-new", "text": "下期可以多一点幕后花絮"}],
            },
        )
        cached = client.get(
            "/api/comments/stats",
            params={"platform": "bilibili", "thread_id": "BV1test"},
        ).json()
        assert cached["cached"] is True
        assert cached["total"] == len(comments)
        assert cached["new_comments"] == 1

        refreshed = client.get(
            "/api/comments/stats",
            params={"platform": "bilibili", "thread_id": "BV1test", "force": "true"},
        ).json()
        assert refreshed["cached"] is False
        assert refreshed["total"] == len(comments) + 1

        feedback = client.post(
            "/api/feedback",
            json={
                "target_type": "comment",
                "target_id": "BV1test:c0",
                "original_category": "suggestion",
                "corrected_category": "praise",
                "note": "smoke test",
            },
        ).json()
        assert feedback["ok"] is True

    print("OK: all smoke tests passed")
    print("temp data:", os.environ["CG_DATA_DIR"])


if __name__ == "__main__":
    main()
