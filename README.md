# Exhibition Agent



전시장 노트북에서 돌리는 **한 패키지**입니다.



| 구성 | 역할 | 실행 |

|------|------|------|

| **`web/`** | Next.js — 이벤트 버스 `/api/events/*`, 태블릿·스태프 제어 UI (포트 **3001**) | `cd web && npm install && npm run dev` |

| **루트 `app/`** | FastAPI — 이벤트 폴링·씬 엔진·조명·사운드·디스플레이 브리지 (포트 **8000**) | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |

| **`arduino-test/`** | NeoPixel 등 펌웨어 실험용 `.ino` (Arduino IDE) | 보드에 업로드 |

| **`config/`** | `scenes.yaml`, `auto_strategy.yaml` | — |



태블릿·스태프 UI는 **`web`** 에서 이벤트를 발행하고, FastAPI는 **`EVENT_BRIDGE_BASE_URL`** (기본 `http://127.0.0.1:3001`) 로 같은 버스를 pull 합니다.



환경 변수는 **`web/.env.local`** 및 **`exhibition-agent/`** 루트의 `.env*` 를 FastAPI 시작 시 읽습니다 (`app/env_load.py`). **`chatbot/` 과는 공유하지 않습니다.**



```powershell

cd exhibition-agent

python -m pip install -r requirements.txt

uvicorn app.main:app --host 0.0.0.0 --port 8000

```



별도 터미널에서 웹:



```powershell

cd exhibition-agent/web

npm install

npm run dev

```



루트 **`exhibition-suite/start-dev.bat`** 이 **HTTPS** 웹(3001, `npm run dev:lan:https`)과 FastAPI(8000)를 한 번에 띄웁니다.  
태블릿은 **`https://노트북IP:3001`** — 설명은 상위 폴더 `README.md` 참고.



### 장치 브리지 URL (선택)



같은 Wi-Fi 안에서 노트북이 ESP·시그니지 서버로 POST 할 때만 설정합니다. 비어 있으면 해당 채널은 **스텁**(메모리에만 마지막 명령 기록).

```powershell

# $env:EVENT_BRIDGE_BASE_URL="http://127.0.0.1:3001"

# $env:EXHIBITION_LIGHT_HTTP_URL="http://192.168.0.51"

# $env:EXHIBITION_LIGHT_HTTP_TOKEN=""           # 선택

# $env:EXHIBITION_DISPLAY_HTTP_URL="http://192.168.0.52"

# $env:EXHIBITION_DISPLAY_HTTP_TOKEN=""       # 선택

# $env:USE_VISION_API="false"

# $env:MANUAL_SCENE_AUTO_RESUME_SEC="120"

```



조명 POST 계약(ESP에서 구현): `POST {BASE}/light/scene`  

JSON 예: `scene_id`, `zone`, `brightness`, `color_temp`, `transition_ms`



디스플레이 POST 계약(수신 서버에서 구현): `POST {BASE}/display/apply`  

JSON 예: `scene_id`, `zone`, `layout_id`, `headline`, `subtitle`



### 조명만 VPS + 미니 PC 없이 (pull 모드)



전시장에 **노트북을 두지 않고** 클라우드 VPS 에서 에이전트를 돌리려면, 조명은 **사설 IP 로 들어오는 POST 가 아니라** ESP 가 **아웃바운드 HTTPS 폴링**으로 명령을 가져가야 합니다.



1. 서버 `.env`: `EXHIBITION_LIGHT_MODE=pull`, `EXHIBITION_DEVICE_TOKEN=(긴 비밀값)`  
2. 리버스 프록시(Nginx 등)가 **`/device/light/next`** 를 FastAPI(uvicorn) 로 넘김  
3. ESP 스케치: `arduino-test/esp32_https_light_pull/esp32_https_light_pull.ino` (학교망은 `_pull_ent`)  
   - `AGENT_BASE` = 공인 `https://도메인`, `DEVICE_TOKEN` = 서버와 동일  
4. **pull 큐는 프로세스 메모리** — 운영 시 uvicorn 워커는 **1개** 권장(여러 워커면 Redis 등 공유 저장소로 바꿔야 함)



폴링 계약: `GET /device/light/next?since={seq}` · 헤더 `Authorization: Bearer {TOKEN}`  

· 새 명령 있음 → `200` + 기존 POST 바디 필드와 동일한 JSON + `seq`  

· 없음 → `204`



기존 **`esp32_http_light.ino`** 는 ESP 가 HTTP **서버**로 POST 를 받는 방식(전시장 LAN + 노트북/게이트웨이와 잘 맞음). VPS 단독 조합은 **`esp32_https_light_pull`** 쪽을 씁니다.



## 기능 구조



| 레이어 | 역할 |

|--------|------|

| **Ingress (`web`)** | 이벤트 버스 publish/pull/state/heartbeat API |

| **Ingress (FastAPI)** | `/api/events/pull` 폴링, `POST /override`, Vision `POST /analyze` |

| **씬 엔진** | `sensor.state` / `scenario.override` / `chat.scene_hint` / `scene.execute` → `SceneDecision` |

| **출력 드라이버** | `LightDriver`(push: POST ESP / pull: 큐+폴링), `SpeakerDriver`(스텁), `DisplayDriver`(시그니지 HTTP) |



## FastAPI 엔드포인트



- `GET /health`, `GET /status`, `POST /override`, `GET /device/light/next`(pull 조명 전용)

- `GET /vision/config`, `GET /test-vision`, `POST /analyze`

- `WS /ws`

- 하트비트: `POST {EVENT_BRIDGE_BASE_URL}/api/events/heartbeat` (`service`: **`exhibition-agent`**)



(구 `spatial-environment-agent` + 별도 `control` 웹앱을 이 폴더 안으로 합친 구조입니다.)

