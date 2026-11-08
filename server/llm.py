from __future__ import annotations

import json
import re
from typing import Any

import httpx

from .config import settings


class LLMError(RuntimeError):
    pass


def extract_json(raw: str) -> Any:
    """Best-effort JSON extraction from a local model response."""
    text = (raw or "").strip()
    if not text:
        raise LLMError("模型返回为空")

    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    for left, right in (("{", "}"), ("[", "]")):
        start = text.find(left)
        end = text.rfind(right)
        if start != -1 and end > start:
            snippet = text[start : end + 1]
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                continue
    raise LLMError("模型返回不是合法 JSON")


async def ollama_chat_json(system: str, user: str) -> Any:
    if settings.llm_backend == "mock":
        raise LLMError("mock 模式不调用 Ollama")

    url = f"{settings.ollama_base_url}/api/chat"
    payload = {
        "model": settings.ollama_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "top_p": 0.8,
            "num_ctx": 8192,
        },
    }
    timeout = httpx.Timeout(settings.ollama_timeout, connect=8.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.ConnectError as exc:
        raise LLMError("连不上 Ollama，请确认 `ollama serve` 已启动") from exc
    except httpx.HTTPStatusError as exc:
        raise LLMError(f"Ollama 返回 HTTP {exc.response.status_code}") from exc
    except Exception as exc:  # noqa: BLE001
        raise LLMError(f"Ollama 调用失败：{exc}") from exc

    content = (data.get("message") or {}).get("content", "")
    return extract_json(content)


async def ollama_health() -> dict[str, Any]:
    if settings.llm_backend == "mock":
        return {
            "backend": "mock",
            "reachable": True,
            "model": "mock",
            "model_present": True,
            "models": ["mock"],
            "detail": "当前是 mock 模式，只使用规则层，不调用大模型",
        }

    url = f"{settings.ollama_base_url}/api/tags"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=3.0)) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
    except Exception as exc:  # noqa: BLE001
        return {
            "backend": "ollama",
            "reachable": False,
            "model": settings.ollama_model,
            "model_present": False,
            "models": [],
            "detail": f"连不上 Ollama：{exc}",
        }

    models = [m.get("name", "") for m in data.get("models", []) if isinstance(m, dict)]
    model_present = any(
        name == settings.ollama_model
        or name.startswith(settings.ollama_model + ":")
        or name.startswith(settings.ollama_model + "-")
        for name in models
    )
    return {
        "backend": "ollama",
        "reachable": True,
        "model": settings.ollama_model,
        "model_present": model_present,
        "models": models,
        "detail": "模型已就绪" if model_present else f"Ollama 已启动，但没有找到模型 {settings.ollama_model}",
    }
