"""Contract test for the Ollama HTTP path, using a fake local HTTP server.

Run from the project root:
    .venv\\Scripts\\python.exe scripts\\llm_contract_test.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


class FakeOllama(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # silence
        return

    def _json(self, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        if self.path == "/api/tags":
            self._json({"models": [{"name": "qwen2.5:7b-instruct"}]})
            return
        self.send_error(404)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        system = body["messages"][0]["content"]
        user = body["messages"][1]["content"]

        if "私信" in system:
            content = {
                "category": "collab",
                "severity": 1,
                "confidence": 0.93,
                "reason": "对方明确表示要聊后续安排",
                "evidence": ["后续安排"],
                "hide_preview": False,
            }
        else:
            ids = re.findall(r'"id":"([^"]+)"', user)
            content = {
                "results": [
                    {
                        "id": comment_id,
                        "category": "suggestion",
                        "stance": "实用建议",
                        "topic": "剪辑节奏",
                        "is_actionable_suggestion": True,
                        "suggestion": "把开头剪短",
                        "confidence": 0.9,
                        "reason": "可执行建议",
                    }
                    for comment_id in ids
                ]
            }

        self._json({"message": {"role": "assistant", "content": json.dumps(content, ensure_ascii=False)}})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    data_dir = Path(tempfile.mkdtemp(prefix="creator-guard-llm-test-", dir=ROOT))
    os.environ["CG_LLM_BACKEND"] = "ollama"
    os.environ["CG_OLLAMA_BASE_URL"] = f"http://127.0.0.1:{port}"
    os.environ["CG_OLLAMA_MODEL"] = "qwen2.5:7b-instruct"
    os.environ["CG_DATA_DIR"] = str(data_dir)

    from fastapi.testclient import TestClient  # noqa: E402

    from server.app import app  # noqa: E402

    try:
        with TestClient(app) as client:
            health = client.get("/api/health").json()
            assert health["llm"]["reachable"] is True
            assert health["llm"]["model_present"] is True

            dm = client.post(
                "/api/dm/classify",
                json={
                    "platform": "bilibili",
                    "conversation_key": "llm:1",
                    "conversation_name": "合作方",
                    "preview": "想和你聊聊后续安排",
                    "text": "你好，想和你聊聊后续安排，方便的时候回复我。",
                },
            ).json()
            assert dm["category"] == "collab", dm
            assert dm["source"] == "llm+rules", dm
            assert dm["action"] == "寻求合作，请尽快处理", dm

            comments = client.post(
                "/api/comments/classify",
                json={
                    "platform": "bilibili",
                    "thread_id": "BVllm",
                    "thread_title": "测试",
                    "comments": [
                        {"id": "c1", "text": "建议把开头剪短一点"},
                        {"id": "c2", "text": "这期很好看"},
                    ],
                },
            ).json()
            assert comments["degraded"] is False
            assert comments["results"][0]["category"] == "suggestion"
            assert comments["results"][0]["source"] == "llm+rules"
            assert comments["results"][1]["category"] == "suggestion"
    finally:
        server.shutdown()
        server.server_close()

    print("OK: Ollama HTTP contract test passed")
    print("temp data:", data_dir)


if __name__ == "__main__":
    main()
