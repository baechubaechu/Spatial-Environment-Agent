import asyncio
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from app.env_load import load_repo_env

load_repo_env()

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, WebSocket
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.device.display_driver import DisplayDriver
from app.device.light_driver import LightDriver
from app.device.light_pull_queue import peek_for_device
from app.device.speaker_driver import SpeakerDriver
from app.scene_engine import ChatHint, OverrideInput, SceneDecision, SensorState, load_default_scene_engine
from app.vision_google import (
    VisionUnavailableError,
    analyze_emotion_from_image_bytes,
    get_vision_client,
)

Zone = Literal["zoneA", "zoneB", "all"]


class RuntimeState(BaseModel):
    last_sensor: Optional[SensorState] = None
    last_hint: Optional[ChatHint] = None
    last_override: Optional[OverrideInput] = None
    last_decision: Optional[SceneDecision] = None
    last_updated: Optional[str] = None
    # time.monotonic() 기준 — 관람자 도면 핀(scene.execute) 잠금 만료 시각
    manual_lock_until_monotonic: Optional[float] = None


def _event_bridge_ssl_verify() -> bool:
    """Next dev --experimental-https 자체 서명 연결 시 `EVENT_BRIDGE_SSL_VERIFY=false`."""
    raw = os.getenv("EVENT_BRIDGE_SSL_VERIFY", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


class EventConsumer:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.after = 0
        self.client = httpx.AsyncClient(timeout=5, verify=_event_bridge_ssl_verify())

    async def pull(self) -> list[dict[str, Any]]:
        params = {
            "after": self.after,
            "limit": 100,
            "topics": "sensor.state,scenario.override,chat.scene_hint,scene.execute",
        }
        r = await self.client.get(f"{self.base_url}/api/events/pull", params=params)
        r.raise_for_status()
        data = r.json()
        items = data.get("items", [])
        self.after = int(data.get("nextAfter", self.after))
        return items

    async def heartbeat(self, detail: str = "running") -> None:
        await self.client.post(
            f"{self.base_url}/api/events/heartbeat",
            json={"service": "exhibition-agent", "status": "ok", "detail": detail},
        )


class SceneExecutor:
    """태블릿·이벤트 버스에서 결정된 씬을 조명·사운드·디스플레이로 동시에 적용."""

    def __init__(
        self,
        light: LightDriver,
        speaker: SpeakerDriver,
        display: DisplayDriver,
        scene_engine=load_default_scene_engine(),
    ):
        self.light = light
        self.speaker = speaker
        self.display = display
        self.scene_engine = scene_engine

    async def apply(self, decision: SceneDecision) -> None:
        scene = self.scene_engine.scene_map.get(decision.scene_id)
        if scene is None:
            scene = self.scene_engine.scene_map[self.scene_engine.catalog.safe_scene]
        await self.light.apply_scene(
            zone=decision.target_zone,
            scene_id=scene.id,
            brightness=scene.light.brightness,
            color_temp=scene.light.color_temp,
            transition_ms=scene.light.transition_ms,
        )
        await self.speaker.apply_scene(
            zone=decision.target_zone,
            track=scene.sound.track,
            volume=scene.sound.volume,
            fade_ms=scene.sound.fade_ms,
        )
        if scene.display is not None:
            await self.display.apply_preset(
                scene.display,
                zone=decision.target_zone,
                scene_id=scene.id,
            )


app = FastAPI(title="Exhibition Agent")
state = RuntimeState()
engine = load_default_scene_engine()
executor = SceneExecutor(LightDriver(), SpeakerDriver(), DisplayDriver(), engine)
bus = EventConsumer(os.getenv("EVENT_BRIDGE_BASE_URL", "http://127.0.0.1:3001"))
USE_VISION_API = os.getenv("USE_VISION_API", "false").lower() in ("1", "true", "yes")
# 관람자가 control에서 scene.execute(분위기 타일)을 누른 뒤, 이 시간(초) 동안 추가 조작이 없으면 sensor 기반 자동 전략으로 복귀
MANUAL_SCENE_AUTO_RESUME_SEC = float(os.getenv("MANUAL_SCENE_AUTO_RESUME_SEC", "120"))
# 이벤트 버스 폴링 간격(초). 낮출수록 scene.execute → 조명 지연 감소 (CPU·하트비트 부하는 ENV 로 조절)
EVENT_CONSUME_POLL_SEC = float(os.getenv("EVENT_CONSUME_POLL_SEC", "0.15"))
# 소비 루프가 빨라질 때 하트비트 POST 난사 방지 (초)
EVENT_HEARTBEAT_MIN_INTERVAL_SEC = float(os.getenv("EVENT_HEARTBEAT_MIN_INTERVAL_SEC", "2"))
_consume_last_hb_mono: float = 0.0
vision_client: Any | None = None
ws_clients: set[WebSocket] = set()
lock = asyncio.Lock()


def build_status_payload() -> dict[str, Any]:
    """WS·GET /status 공통 — monotonic 잠금은 사람이 읽기 쉬운 필드로 덧붙임."""
    payload = state.model_dump()
    u = state.manual_lock_until_monotonic
    now = time.monotonic()
    if u is not None and now < u:
        payload["visitor_manual_lock"] = True
        payload["visitor_manual_lock_remaining_sec"] = round(u - now, 1)
    else:
        payload["visitor_manual_lock"] = False
        payload["visitor_manual_lock_remaining_sec"] = 0.0
    return payload


def visitor_manual_locked() -> bool:
    u = state.manual_lock_until_monotonic
    return u is not None and time.monotonic() < u


async def broadcast() -> None:
    payload = build_status_payload()
    dead: list[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_clients.discard(ws)


async def decide_and_apply(reason: str) -> None:
    decision = engine.choose_scene(state.last_sensor, state.last_hint, state.last_override)
    if reason:
        decision.reason = reason
    await executor.apply(decision)
    state.last_decision = decision
    state.last_updated = datetime.now(timezone.utc).isoformat()
    await broadcast()


def parse_event(event: dict[str, Any]) -> tuple[str, Any]:
    topic = event.get("topic", "")
    payload = event.get("payload", {})
    return topic, payload


def emotion_from_scores(scores: dict[str, float]) -> str:
    if not scores:
        return "neutral"
    dominant = max(scores, key=scores.get)
    if dominant == "anger":
        return "stressed"
    if dominant == "surprise":
        return "active"
    if dominant == "sorrow":
        return "calm"
    return "neutral"


async def consume_loop() -> None:
    global _consume_last_hb_mono
    while True:
        try:
            events = await bus.pull()
            for e in events:
                topic, payload = parse_event(e)
                if topic == "sensor.state":
                    state.last_sensor = SensorState(
                        people_count=payload.get("peopleCount", 0),
                        decibel=payload.get("decibel", 0),
                        emotion_state=payload.get("emotionState", "neutral"),
                        occupancy_zone=payload.get("occupancyZone", "all"),
                    )
                    state.last_override = None
                    if not visitor_manual_locked():
                        await decide_and_apply("sensor update")
                    else:
                        await broadcast()
                elif topic == "scenario.override":
                    state.manual_lock_until_monotonic = None
                    state.last_override = OverrideInput(
                        people_count=payload.get("peopleCount"),
                        decibel=payload.get("decibel"),
                        emotion_state=payload.get("emotionState"),
                        duration_sec=payload.get("durationSec"),
                        profile_name=payload.get("profileName"),
                        target_zone=payload.get("targetZone", "all"),
                    )
                    await decide_and_apply("manual override")
                elif topic == "chat.scene_hint":
                    state.last_hint = ChatHint(
                        intent_tag=payload.get("intentTag", "general_exhibit"),
                        confidence=float(payload.get("confidence", 0.5)),
                        target_zone=payload.get("targetZone", "all"),
                    )
                    if not visitor_manual_locked():
                        await decide_and_apply("chat hint")
                    else:
                        await broadcast()
                elif topic == "scene.execute":
                    decision = SceneDecision(
                        scene_id=payload.get("sceneId", "safe_neutral"),
                        hold_sec=int(payload.get("holdSec", 60)),
                        target_zone=payload.get("targetZone", "all"),
                        reason=payload.get("reason", "external execute"),
                    )
                    await executor.apply(decision)
                    state.last_decision = decision
                    state.last_updated = datetime.now(timezone.utc).isoformat()
                    state.manual_lock_until_monotonic = (
                        time.monotonic() + MANUAL_SCENE_AUTO_RESUME_SEC
                    )
                    await broadcast()

            now_mono = time.monotonic()
            if now_mono - _consume_last_hb_mono >= EVENT_HEARTBEAT_MIN_INTERVAL_SEC:
                await bus.heartbeat(detail="events consumed")
                _consume_last_hb_mono = now_mono
        except Exception as err:
            await bus.heartbeat(detail=f"degraded: {type(err).__name__}")
            _consume_last_hb_mono = time.monotonic()
        await asyncio.sleep(EVENT_CONSUME_POLL_SEC)


async def visitor_idle_watch_loop() -> None:
    """관람자 scene.execute 잠금이 만료되면 자동 전략(sensor)으로 복귀."""
    while True:
        await asyncio.sleep(1)
        try:
            u = state.manual_lock_until_monotonic
            if u is None or time.monotonic() < u:
                continue
            async with lock:
                u2 = state.manual_lock_until_monotonic
                if u2 is None or time.monotonic() < u2:
                    continue
                state.manual_lock_until_monotonic = None
            await decide_and_apply("visitor idle → auto strategy")
        except Exception:
            pass


@app.on_event("startup")
async def on_startup() -> None:
    asyncio.create_task(consume_loop())
    asyncio.create_task(visitor_idle_watch_loop())


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/device/light/next", response_model=None)
async def device_light_next(
    since: int = 0,
    authorization: str | None = Header(None),
):
    """ESP32 가 VPS 를 향해 HTTPS 폴링할 때 사용. EXHIBITION_LIGHT_MODE=pull 필수."""
    if os.getenv("EXHIBITION_LIGHT_MODE", "push").strip().lower() != "pull":
        raise HTTPException(status_code=404, detail="pull mode disabled")
    expected = os.getenv("EXHIBITION_DEVICE_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="EXHIBITION_DEVICE_TOKEN not set")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    got = authorization[7:].strip()
    if not secrets.compare_digest(got, expected):
        raise HTTPException(status_code=401, detail="invalid token")

    seq, body = await peek_for_device(since)
    if body is None:
        return Response(status_code=204)
    return {"seq": seq, **body}


@app.get("/status")
async def status() -> dict[str, Any]:
    return build_status_payload()


@app.get("/vision/config")
async def vision_config() -> dict[str, Any]:
    return {
        "enabled": USE_VISION_API,
        "endpoint": "/analyze",
        "credentials_hint": "GOOGLE_APPLICATION_CREDENTIALS",
    }


@app.get("/test-vision")
async def test_vision() -> dict[str, Any]:
    if not USE_VISION_API:
        return {"ok": False, "enabled": False, "error": "USE_VISION_API is false"}
    try:
        global vision_client
        if vision_client is None:
            vision_client = get_vision_client()
        return {"ok": True, "enabled": True}
    except Exception as err:
        return {"ok": False, "enabled": True, "error": str(err)}


@app.post("/analyze")
async def analyze(
    frame: UploadFile = File(...),
    noise_level: float = Form(0.0),
) -> dict[str, Any]:
    if not USE_VISION_API:
        return {
            "ok": True,
            "vision_enabled": False,
            "people_count": 0,
            "avg_scores": {"joy": 0.0, "sorrow": 0.0, "anger": 0.0, "surprise": 0.0},
            "emotion_state": "neutral",
            "noise_level": noise_level,
        }

    try:
        img_bytes = await frame.read()
        global vision_client
        if vision_client is None:
            vision_client = get_vision_client()
        analyzed = analyze_emotion_from_image_bytes(vision_client, img_bytes)
        scores_for_emotion = analyzed.get("primary_avg_scores") or analyzed.get("avg_scores", {})
        emotion_state = emotion_from_scores(scores_for_emotion)
        displays = analyzed.get("face_displays") or []
        body: dict[str, Any] = {
            "ok": True,
            "vision_enabled": True,
            "people_count": analyzed.get("people_count", 0),
            "avg_scores": analyzed.get("avg_scores", {}),
            "primary_avg_scores": analyzed.get("primary_avg_scores", {}),
            "emotion_state": emotion_state,
            "noise_level": noise_level,
        }
        if displays:
            body["faces"] = displays[:12]
        return body
    except VisionUnavailableError as err:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "vision_enabled": True, "error": str(err)},
        )
    except Exception as err:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "vision_enabled": True, "error": str(err)},
        )


@app.post("/override")
async def override(input_data: OverrideInput) -> dict[str, Any]:
    async with lock:
        state.manual_lock_until_monotonic = None
        state.last_override = input_data
    await decide_and_apply("manual override endpoint")
    return {"ok": True, "decision": state.last_decision.model_dump() if state.last_decision else None}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    ws_clients.add(ws)
    try:
        await ws.send_json(build_status_payload())
        while True:
            await ws.receive_text()
    except Exception:
        ws_clients.discard(ws)
