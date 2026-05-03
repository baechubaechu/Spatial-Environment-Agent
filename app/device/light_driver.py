"""
조명 제어 — push: 로컬망 ESP 에 HTTP POST / pull: VPS 큐에 쌓고 ESP 가 HTTPS 로 폴링.

Tapo 등 기존 스택은 제거했습니다.
- push 모드에서 EXHIBITION_LIGHT_HTTP_URL 이 비어 있으면 네트워크 호출 없음.
- pull 모드에서는 큐에만 넣음(GET /device/light/next).
"""
from __future__ import annotations

import os
from typing import Literal

import httpx

from app.device.light_pull_queue import enqueue_light_command

Zone = Literal["zoneA", "zoneB", "all"]


class LightDriver:
    def __init__(self) -> None:
        self.last_command: dict | None = None
        self._mode = os.getenv("EXHIBITION_LIGHT_MODE", "push").strip().lower()
        self._base_url = os.getenv("EXHIBITION_LIGHT_HTTP_URL", "").rstrip("/")
        self._token = os.getenv("EXHIBITION_LIGHT_HTTP_TOKEN", "")

    async def apply_scene(
        self,
        *,
        zone: Zone,
        scene_id: str,
        brightness: int,
        color_temp: int,
        transition_ms: int,
    ) -> None:
        b = min(max(int(brightness), 0), 100)
        body = {
            "scene_id": scene_id,
            "zone": zone,
            "brightness": b,
            "color_temp": int(color_temp),
            "transition_ms": int(transition_ms),
        }
        self.last_command = body

        if self._mode == "pull":
            await enqueue_light_command(body)
            return

        if not self._base_url:
            return

        headers: dict[str, str] = {}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(f"{self._base_url}/light/scene", json=body, headers=headers)
            r.raise_for_status()
