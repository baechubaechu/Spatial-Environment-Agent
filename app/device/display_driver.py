"""
TV·모니터 등 시각 레이어 — 시그니지 HTTP 엔드포인트로 상태를 넘깁니다.

전시 현장에서는 TV에 붙은 PC/브라우저가 같은 URL을 구독하거나,
별도 미니 서버가 이 페이로드를 받아 HDMI 장비를 전환할 수 있습니다.

EXHIBITION_DISPLAY_HTTP_URL 이 비어 있으면 호출하지 않습니다.
"""
from __future__ import annotations

import os
from typing import Literal

import httpx

from app.scene_engine import DisplayPreset

Zone = Literal["zoneA", "zoneB", "all"]


class DisplayDriver:
    def __init__(self) -> None:
        self.last_command: dict | None = None
        self._base_url = os.getenv("EXHIBITION_DISPLAY_HTTP_URL", "").rstrip("/")
        self._token = os.getenv("EXHIBITION_DISPLAY_HTTP_TOKEN", "")

    async def apply_preset(self, preset: DisplayPreset, *, zone: Zone, scene_id: str) -> None:
        body = {
            "scene_id": scene_id,
            "zone": zone,
            "layout_id": preset.layout_id,
            "headline": preset.headline,
            "subtitle": preset.subtitle,
        }
        self.last_command = body

        if not self._base_url:
            return

        headers: dict[str, str] = {}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(f"{self._base_url}/display/apply", json=body, headers=headers)
            r.raise_for_status()
