from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Load .env if python-dotenv is installed; otherwise keep working."""
    try:
        from dotenv import load_dotenv

        load_dotenv(PROJECT_DIR / ".env")
    except Exception:
        pass


_load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("CG_DATA_DIR", str(BASE_DIR / "data"))).expanduser()
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _as_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    db_path: Path
    llm_backend: str
    ollama_base_url: str
    ollama_model: str
    ollama_timeout: float
    stats_window_days: int
    retention_days: int
    max_dm_chars: int
    max_comment_chars: int
    auto_stats: bool
    log_level: str


settings = Settings(
    host=os.getenv("CG_HOST", "127.0.0.1"),
    port=int(os.getenv("CG_PORT", "8765")),
    db_path=Path(os.getenv("CG_DB_PATH", str(DATA_DIR / "creator_guard.db"))).expanduser(),
    llm_backend=os.getenv("CG_LLM_BACKEND", "ollama").strip().lower(),
    ollama_base_url=os.getenv("CG_OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
    ollama_model=os.getenv("CG_OLLAMA_MODEL", "qwen2.5:7b-instruct").strip(),
    ollama_timeout=float(os.getenv("CG_OLLAMA_TIMEOUT", "120")),
    stats_window_days=int(os.getenv("CG_STATS_WINDOW_DAYS", "5")),
    retention_days=int(os.getenv("CG_RETENTION_DAYS", "30")),
    max_dm_chars=int(os.getenv("CG_MAX_DM_CHARS", "6000")),
    max_comment_chars=int(os.getenv("CG_MAX_COMMENT_CHARS", "800")),
    auto_stats=_as_bool("CG_AUTO_STATS", True),
    log_level=os.getenv("CG_LOG_LEVEL", "INFO").upper(),
)
