"""FastAPI server for Emotional Space AI - tablet browser input + Tapo control."""
import traceback
import time
from collections import deque
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from google.cloud import vision

from backend.config import ABSENCE_GRACE_SEC, HISTORY_SIZE, USE_VISION_API
from backend.emotion_engine import average_scores, detect_emotion_scores
from backend.occupancy import OccupancyTracker
from backend.policy import decide_state, get_light_config, get_state_goal, get_white_noise_config
from backend.tapo_controller import apply_light_state, reset_controllers, turn_off_lights

app = FastAPI(title="Emotional Space AI")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# Frontend static files
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

# Global state (single tablet session)
emotion_history: deque = deque(maxlen=HISTORY_SIZE)
occupancy_tracker = OccupancyTracker(grace_sec=ABSENCE_GRACE_SEC)
current_state = "idle"
vision_client = None
_last_frame_bytes = None
_last_monitor_data = None

# Vision API 끄면 컨트롤 화면에서 지정한 값 사용 (0~5)
manual_override = {
    "people_count": 0,
    "joy": 0.0,
    "sorrow": 0.0,
    "anger": 0.0,
    "surprise": 0.0,
    "noise_level": 0.0,  # 0~1, 마이크 오버라이드
}


def _get_vision_client():
    global vision_client
    if vision_client is None:
        vision_client = vision.ImageAnnotatorClient()
    return vision_client


def classify_noise(noise_value: float) -> tuple[str, float]:
    """noise_value 0~1 from frontend -> (level_str, score)."""
    if noise_value < 0.4:
        return "low", noise_value * 0.5
    if noise_value < 0.8:
        return "medium", 0.4 + (noise_value - 0.4) * 0.5
    return "high", min(0.8 + (noise_value - 0.8) * 1.0, 1.0)


@app.get("/test-vision")
async def test_vision():
    """Test if Google Cloud Vision API is working."""
    # Minimal valid 1x1 pixel JPEG - Vision API accepts it, returns 0 faces (confirms credentials)
    MINIMAL_JPEG = (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c"
        b"\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c"
        b"\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\xff\xc0\x00\x0b\x08\x00"
        b"\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01"
        b"\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07"
        b"\x08\t\n\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05"
        b"\x04\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07"
        b'"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18'
        b"\x19\x1a%&'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x83\x84\x85\x86"
        b"\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6"
        b"\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6"
        b"\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5"
        b"\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xda\x00"
        b"\x08\x01\x01\x00\x00?\x00\xfc\xb3\xff\xd9"
    )
    try:
        client = _get_vision_client()
        image = vision.Image(content=MINIMAL_JPEG)
        response = client.face_detection(image=image)
        if response.error.message:
            return {"ok": False, "error": response.error.message}
        face_count = len(response.face_annotations)
        return {
            "ok": True,
            "message": "Vision API is working",
            "test_faces": face_count,
            "credentials": "OK",
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            content={"ok": False, "error": str(e), "detail": traceback.format_exc()},
            status_code=500,
        )


@app.get("/api/monitor-data")
async def api_monitor_data():
    """Return last analyze result (from tablet). For desktop monitor display."""
    global _last_monitor_data
    if _last_monitor_data is None:
        return {"ok": False, "error": "태블릿에서 메인 앱(/) 실행 후 카메라·마이크 허용 필요", "data": None}
    return {"ok": True, "data": _last_monitor_data}


@app.get("/api/control")
async def api_get_control():
    """현재 수동 지정값 + Vision API 사용 여부."""
    return {"vision_api_enabled": USE_VISION_API, "manual": manual_override.copy()}


@app.post("/api/simulate")
async def api_simulate(
    noise_level: float = Body(None),
    people_count: int = Body(None),
    joy: float = Body(None),
    sorrow: float = Body(None),
    anger: float = Body(None),
    surprise: float = Body(None),
):
    """컨트롤 값으로 파이프라인 실행 (태블릿 없이 테스트). Vision API 호출 없음."""
    global current_state, _last_monitor_data, manual_override
    if people_count is not None:
        manual_override["people_count"] = max(0, int(people_count))
    for k, v in [("joy", joy), ("sorrow", sorrow), ("anger", anger), ("surprise", surprise)]:
        if v is not None:
            manual_override[k] = max(0.0, min(5.0, float(v)))
    if noise_level is not None:
        manual_override["noise_level"] = max(0.0, min(1.0, float(noise_level)))
    face_count = manual_override["people_count"]
    noise_level = noise_level if noise_level is not None else manual_override["noise_level"]
    avg_scores = {
        "joy": manual_override["joy"],
        "sorrow": manual_override["sorrow"],
        "anger": manual_override["anger"],
        "surprise": manual_override["surprise"],
    }
    now = time.monotonic()
    occupancy_duration = occupancy_tracker.update(face_count=face_count, now=now)
    noise_level_str, noise_score = classify_noise(noise_level)
    state_label, crowding, mood_score, stress_score = decide_state(
        people_count=face_count,
        occupancy_duration=occupancy_duration,
        avg_scores=avg_scores,
        noise_score=noise_score,
    )
    if state_label != current_state:
        await apply_light_state(state_label)
        current_state = state_label
    light_config = get_light_config(state_label)
    white_noise = get_white_noise_config(noise_level, state_label, stress_score)
    result = {
        "status": "ok",
        "faces": [],
        "people_count": face_count,
        "noise_level": noise_level_str,
        "noise_score": noise_score,
        "occupancy_time": round(occupancy_duration, 1),
        "state": state_label,
        "goal": get_state_goal(state_label),
        "light": {"brightness": light_config["brightness"], "color_temp": light_config["color_temp"]},
        "avg_scores": avg_scores,
        "crowding": round(crowding, 2),
        "mood_score": round(mood_score, 2),
        "stress_score": round(stress_score, 2),
        "white_noise": white_noise,
    }
    _last_monitor_data = {
        "input": {"noise_level_raw": noise_level, "frame_size_bytes": 0},
        "output": result,
        "timestamp": time.time(),
    }
    return result


@app.post("/api/preview")
async def api_preview(
    people_count: int = Body(None),
    joy: float = Body(None),
    sorrow: float = Body(None),
    anger: float = Body(None),
    surprise: float = Body(None),
    noise_level: float = Body(None),
):
    """조정값으로 AI 목표·조명·백색소음 미리보기 (조명 미적용)."""
    pc = manual_override["people_count"] if people_count is None else max(0, int(people_count))
    avg = {
        "joy": manual_override["joy"] if joy is None else max(0, min(5, float(joy))),
        "sorrow": manual_override["sorrow"] if sorrow is None else max(0, min(5, float(sorrow))),
        "anger": manual_override["anger"] if anger is None else max(0, min(5, float(anger))),
        "surprise": manual_override["surprise"] if surprise is None else max(0, min(5, float(surprise))),
    }
    noise = noise_level if noise_level is not None else manual_override.get("noise_level", 0)
    noise_str, noise_score = classify_noise(noise)
    occ = 5.0 if pc > 0 else 0.0  # 미리보기용 가상 occupancy
    state_label, crowding, mood, stress = decide_state(pc, occ, avg, noise_score)
    light_cfg = get_light_config(state_label)
    wn = get_white_noise_config(noise, state_label, stress)
    return {
        "people_count": pc,
        "state": state_label,
        "goal": get_state_goal(state_label),
        "light": light_cfg,
        "white_noise": wn,
        "noise_level": noise_str,
        "noise_score": noise_score,
    }


@app.post("/api/control")
async def api_set_control(
    people_count: int = Body(None),
    joy: float = Body(None),
    sorrow: float = Body(None),
    anger: float = Body(None),
    surprise: float = Body(None),
    noise_level: float = Body(None),
):
    """인원수·표정값·소음레벨 수동 지정."""
    global manual_override
    if people_count is not None:
        manual_override["people_count"] = max(0, int(people_count))
    for k, v in [("joy", joy), ("sorrow", sorrow), ("anger", anger), ("surprise", surprise)]:
        if v is not None:
            manual_override[k] = max(0.0, min(5.0, float(v)))
    if noise_level is not None:
        manual_override["noise_level"] = max(0.0, min(1.0, float(noise_level)))
    return {"ok": True, "manual": manual_override.copy()}


@app.get("/light")
async def light_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/light.html", status_code=302)


@app.get("/control")
async def control_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/monitor", status_code=302)


@app.get("/monitor")
async def monitor_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/monitor.html", status_code=302)


@app.get("/test-light")
async def test_light_page():
    """Simple page to test Tapo light control (no Vision API)."""
    html = """
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Tapo Light Test</title>
<style>
body{font-family:monospace;background:#111;color:#ccc;padding:20px;}
h1{color:#7dd;} button{padding:12px 20px;margin:8px;font-size:14px;cursor:pointer;
background:#333;color:#fff;border:1px solid #555;border-radius:4px;}
button:hover{background:#444;} #result{margin-top:20px;padding:10px;background:#222;}
</style></head>
<body>
<h1>Tapo Light Control Test</h1>
<p>Select a state to apply to the light:</p>
<button onclick="setState('idle')">IDLE (55%, 4000K)</button>
<button onclick="setState('observed_crowd')">OBSERVED_CROWD (65%, 4200K)</button>
<button onclick="setState('managed_stress')">MANAGED_STRESS (50%, 3000K)</button>
<button onclick="setState('algorithmic_activation')">ALGORITHMIC_ACTIVATION (75%, 4600K)</button>
<button onclick="setState('idle', true)" style="background:#444;color:#888">RESET & RETRY</button>
<div id="result"></div>
<script>
async function setState(s, reset){
  const r=document.getElementById('result');
  r.textContent='Sending...';
  try{
    const url='/api/light?state='+s+(reset?'&reset=1':'');
    const res=await fetch(url);
    const d=await res.json();
    r.textContent=res.ok ? 'OK: '+JSON.stringify(d) : 'Error: '+d.error;
  }catch(e){r.textContent='Error: '+e.message;}
}
</script>
</body></html>
"""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(html)


@app.get("/api/tapo-status")
async def api_tapo_status():
    """Tapo 설정 확인 (디버그용). 실제 연결은 조명 버튼으로 테스트."""
    from backend.config import TAPO_IPS, TAPO_USERNAME
    return {
        "ips": TAPO_IPS,
        "username_set": bool(TAPO_USERNAME and TAPO_USERNAME != "your_tapo_email@example.com"),
        "hint": "조명이 안 되면: 노트북·Tapo가 같은 Wi-Fi(핫스팟)인지 확인. TAPO_IPS 환경변수가 현재 네트워크의 조명 IP인지 확인.",
    }


@app.get("/api/light-off")
async def api_light_off():
    """조명 끄기 전용."""
    try:
        await turn_off_lights()
        return {"ok": True, "state": "off"}
    except Exception as e:
        traceback.print_exc()
        err = str(e)
        if "connect" in err.lower() or "timeout" in err.lower():
            err += " (TAPO_IPS, TAPO_USERNAME, TAPO_PASSWORD 확인)"
        return JSONResponse(content={"ok": False, "error": err}, status_code=500)


@app.get("/api/light")
async def api_set_light(state: str = "idle", reset: bool = False):
    """Set Tapo light state (for testing, no Vision). state=off → 조명 끄기."""
    valid = {"idle", "observed_crowd", "managed_stress", "algorithmic_activation", "off"}
    if state not in valid:
        return JSONResponse(content={"error": f"Invalid state. Use: {list(valid)}"}, status_code=400)
    if reset:
        reset_controllers()
    try:
        if state == "off":
            await turn_off_lights()
        else:
            await apply_light_state(state)
        return {"ok": True, "state": state}
    except Exception as e:
        traceback.print_exc()
        err = str(e)
        if "connect" in err.lower() or "timeout" in err.lower():
            err += " (TAPO_IPS, TAPO_USERNAME, TAPO_PASSWORD 확인)"
        return JSONResponse(content={"ok": False, "error": err}, status_code=500)


@app.get("/")
async def root():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {"message": "Emotional Space AI - Open /static/index.html or deploy frontend"}


@app.get("/last-frame")
async def last_frame():
    """Debug: view the last image received from tablet."""
    global _last_frame_bytes
    if _last_frame_bytes is None:
        return JSONResponse(content={"error": "No frame yet"}, status_code=404)
    from fastapi.responses import Response
    return Response(content=_last_frame_bytes, media_type="image/jpeg")


@app.post("/analyze")
async def analyze(
    frame: UploadFile = File(...),
    noise_level: float = Form(0.0),
):
    """Receive frame + noise from tablet, return faces + state + light."""
    global current_state, emotion_history, _last_frame_bytes

    try:
        img_bytes = await frame.read()
        _last_frame_bytes = img_bytes
    except Exception as e:
        return JSONResponse(content={"error": f"read_image: {e}"}, status_code=400)

    if USE_VISION_API:
        try:
            raw_scores, face_count, face_displays = detect_emotion_scores(
                _get_vision_client(), img_bytes
            )
        except Exception as e:
            traceback.print_exc()
            return JSONResponse(content={"error": str(e), "detail": traceback.format_exc()}, status_code=500)
        if face_count > 0:
            emotion_history.append(raw_scores)
        avg_scores = average_scores(emotion_history)
    else:
        # Vision API 꺼짐: 컨트롤 화면에서 지정한 값 사용
        face_count = manual_override["people_count"]
        face_displays = []
        avg_scores = {
            "joy": manual_override["joy"],
            "sorrow": manual_override["sorrow"],
            "anger": manual_override["anger"],
            "surprise": manual_override["surprise"],
        }

    now = time.monotonic()
    occupancy_duration = occupancy_tracker.update(face_count=face_count, now=now)

    noise_level_str, noise_score = classify_noise(noise_level)

    state_label, crowding, mood_score, stress_score = decide_state(
        people_count=face_count,
        occupancy_duration=occupancy_duration,
        avg_scores=avg_scores,
        noise_score=noise_score,
    )

    # Update Tapo when state changes
    if state_label != current_state:
        await apply_light_state(state_label)
        current_state = state_label

    light_config = get_light_config(state_label)
    white_noise = get_white_noise_config(noise_level, state_label, stress_score)

    # Build face list for frontend overlay
    faces_for_ui = []
    for fd in face_displays:
        faces_for_ui.append({
            "box": fd["box"],
            "percentages": fd["percentages"],
        })

    result = {
        "status": "ok",
        "faces": faces_for_ui,
        "people_count": face_count,
        "noise_level": noise_level_str,
        "noise_score": noise_score,
        "occupancy_time": round(occupancy_duration, 1),
        "state": state_label,
        "goal": get_state_goal(state_label),
        "light": {
            "brightness": light_config["brightness"],
            "color_temp": light_config["color_temp"],
        },
        "avg_scores": avg_scores,
        "crowding": round(crowding, 2),
        "mood_score": round(mood_score, 2),
        "stress_score": round(stress_score, 2),
        "white_noise": white_noise,
    }

    # Store for desktop monitor (input from tablet)
    global _last_monitor_data
    _last_monitor_data = {
        "input": {
            "noise_level_raw": noise_level,
            "frame_size_bytes": len(img_bytes),
        },
        "output": result,
        "timestamp": time.time(),
    }

    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
