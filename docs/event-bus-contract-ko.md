# 이벤트 버스 계약 (MVP)

`exhibition-agent/web` 과 FastAPI **`exhibition-agent`** 가 같은 스키마로 이벤트를 주고받을 때의 참고 문서입니다.  
(이 저장소의 `chatbot/` 앱과는 **연동하지 않습니다**.)

## 토픽

- `sensor.state`
- `scenario.override`
- `chat.scene_hint` (외부 챗·추론 서비스가 쓸 경우 선택)
- `scene.execute`
- `ops.heartbeat`

## 공통 envelope

```json
{
  "eventId": "1713070000000-ab12cd34",
  "sessionId": "optional-session",
  "source": "control-ui | exhibition-agent | external-api",
  "timestamp": "2026-04-14T08:30:00.000Z",
  "ttlMs": 60000
}
```

## payload 스키마

### `sensor.state`

```json
{
  "peopleCount": 7,
  "decibel": 58.4,
  "emotionState": "neutral",
  "occupancyZone": "zoneA"
}
```

### `scenario.override`

```json
{
  "peopleCount": 15,
  "decibel": 72,
  "emotionState": "active",
  "durationSec": 120,
  "profileName": "crowded-demo",
  "targetZone": "all"
}
```

### `chat.scene_hint`

```json
{
  "intentTag": "section_focus",
  "confidence": 0.78,
  "locale": "ko",
  "messageSummary": "단면모형 A에서 동선이 어떻게 연결돼?",
  "targetZone": "zoneA"
}
```

### `scene.execute`

```json
{
  "sceneId": "dense_flux",
  "reason": "override:crowded-demo",
  "holdSec": 90,
  "targetZone": "all"
}
```

### `ops.heartbeat`

```json
{
  "service": "exhibition-agent",
  "status": "ok",
  "detail": "camera/mic online"
}
```

## API 엔드포인트 (web 앱 기준)

- `POST /api/events/publish`
- `GET /api/events/pull?after=0&topics=sensor.state,chat.scene_hint`
- `GET /api/events/state`
- `POST /api/events/heartbeat`
- `POST /api/events/recover`

## 운영 기본값

- 기본 TTL: 60초
- Heartbeat stale 판단: 20초
- Event queue 최대 보관: 최근 500개
