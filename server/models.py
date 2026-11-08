from __future__ import annotations

import hashlib
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Platform = Literal["bilibili", "xiaohongshu"]
DmCategory = Literal["illegal", "malicious", "collab", "suggestion", "spam", "normal"]


def text_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", errors="ignore")).hexdigest()[:24]


class DmPreviewItem(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    preview: str = Field(default="", max_length=500)
    name: str | None = Field(default=None, max_length=80)


class DmPreviewRequest(BaseModel):
    items: list[DmPreviewItem] = Field(default_factory=list, max_length=30)


class DmClassifyRequest(BaseModel):
    platform: Platform
    conversation_key: str = Field(min_length=1, max_length=200)
    conversation_name: str | None = Field(default=None, max_length=80)
    preview: str | None = Field(default=None, max_length=500)
    text: str = Field(min_length=1, max_length=20000)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text 不能为空")
        return value


class DmClassifyResponse(BaseModel):
    category: str
    severity: int = 0
    confidence: float = 0.0
    reason: str = ""
    action: str = ""
    hide_preview: bool = False
    evidence: list[str] = Field(default_factory=list)
    source: str = "rules"
    degraded: bool = False
    error: str | None = None


class CommentItem(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("评论不能为空")
        return value


class CommentClassifyRequest(BaseModel):
    platform: Platform
    thread_id: str = Field(min_length=1, max_length=200)
    thread_title: str | None = Field(default=None, max_length=200)
    comments: list[CommentItem] = Field(default_factory=list, max_length=20)

    @field_validator("comments")
    @classmethod
    def non_empty(cls, value: list[CommentItem]) -> list[CommentItem]:
        if not value:
            raise ValueError("comments 不能为空")
        return value


class CommentFeedbackRequest(BaseModel):
    target_type: Literal["dm", "comment"]
    target_id: str = Field(min_length=1, max_length=300)
    original_category: str | None = Field(default=None, max_length=40)
    corrected_category: str = Field(min_length=1, max_length=40)
    note: str | None = Field(default=None, max_length=500)
