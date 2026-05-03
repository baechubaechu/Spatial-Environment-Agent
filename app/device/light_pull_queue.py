"""VPS·NAT 환경용 — 조명 명령을 메모리에 쌓아두고 ESP가 HTTPS GET 으로 가져감."""

from __future__ import annotations

import asyncio
from typing import Any

_lock = asyncio.Lock()
_seq = 0
_pending: dict[str, Any] | None = None


async def enqueue_light_command(body: dict[str, Any]) -> int:
    global _seq, _pending
    async with _lock:
        _seq += 1
        _pending = dict(body)
        return _seq


async def peek_for_device(since: int) -> tuple[int, dict[str, Any] | None]:
    """since 보다 큰 seq 일 때만 바디 반환 (동일 seq 재전송 없음)."""
    global _seq, _pending
    async with _lock:
        if _pending is None:
            return (_seq, None)
        if _seq <= since:
            return (_seq, None)
        return (_seq, dict(_pending))
