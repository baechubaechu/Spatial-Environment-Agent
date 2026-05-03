"""
조명 제어 — 기본은 로컬망 ESP32(HTTP POST).

Tapo 등 기존 스택은 제거했습니다. EXHIBITION_LIGHT_HTTP_URL 이 비어 있으면
명령만 메모리에 남기고 네트워크 호출은 하지 않습니다(실험·무장치 환경).
"""
from __future__ import annotations

import os
from typing import Literal

import httpx

Zone = Literal["zoneA", "zoneB", "all"]


class LightDriver:
    def __init__(self) -> None:
        self.last_command: dict | None = None
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

        if not self._base_url:
            return

        headers: dict[str, str] = {}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(f"{self._base_url}/light/scene", json=body, headers=headers)
            r.raise_for_status()
