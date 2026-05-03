# Emotional Space AI — 실현 방법 상세 가이드

브라우저 기반 태블릿 입력 + 데스크톱 서버 아키텍처로 전환하는 단계별 가이드입니다.

---

## 1. 사전 준비

### 1.1 개발 환경
- Python 3.10+
- Node.js (선택, 프론트엔드 빌드용)
- Google Cloud 계정 (Vision API 활성화)
- Tapo 스마트 조명 (같은 Wi-Fi에 연결)

### 1.2 Google Cloud Vision API
1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 생성 → APIs & Services → Library → "Cloud Vision API" 검색 후 활성화
3. 서비스 계정 키 생성 (JSON) → `GOOGLE_APPLICATION_CREDENTIALS` 환경변수로 설정

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\your\service-account-key.json"
```

### 1.3 Tapo 계정
- Tapo 앱에서 이메일/비밀번호로 계정 생성
- 조명 IP 확인 (라우터 DHCP 또는 Tapo 앱)

---

## 2. 프로젝트 구조 생성

```text
emotion-ai-space/
├─ backend/
│  ├─ __init__.py
│  ├─ main.py           # FastAPI + WebSocket
│  ├─ config.py         # TAPO_*, CAPACITY 등
│  ├─ emotion_engine.py # Vision API 호출, 퍼센트 계산
│  ├─ policy.py         # decide_state, STATE_SCENES
│  ├─ occupancy.py      # OccupancyTracker
│  ├─ audio_utils.py    # classify_noise_level (서버에서 0~1 수신)
│  ├─ tapo_controller.py
│  └─ models.py         # Pydantic 모델
├─ frontend/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ requirements.txt
├─ .env.example
└─ README.md
```

---

## 3. Phase 1 — 프론트엔드 (태블릿 브라우저)

### 3.1 index.html
- `<video>`: 카메라 미리보기
- `<canvas>`: 얼굴 박스·감정 라벨 오버레이
- `<div>`: PEOPLE DETECTED, NOISE LEVEL, OCCUPANCY TIME, SYSTEM MODE, LIGHT 표시

### 3.2 app.js — 카메라/마이크 캡처

```javascript
// 카메라 + 마이크 권한 요청
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: 'user', width: 640, height: 480 },
  audio: true
});

videoElement.srcObject = stream;
```

### 3.3 app.js — 프레임 전송
- `requestAnimationFrame` 또는 `setInterval`로 주기적 캡처 (예: 1.2초마다)
- `<canvas>.getContext('2d').drawImage(video, 0, 0)`
- `canvas.toBlob(blob => sendToServer(blob), 'image/jpeg', 0.8)`

### 3.4 app.js — 노이즈 레벨 (Web Audio API)

```javascript
const audioContext = new AudioContext();
const source = audioContext.createMediaStreamSource(stream);
const analyser = audioContext.createAnalyser();
source.connect(analyser);

// 주기적으로 RMS 계산
const dataArray = new Uint8Array(analyser.frequencyBinCount);
analyser.getByteTimeDomainData(dataArray);
let sum = 0;
for (let i = 0; i < dataArray.length; i++) {
  const n = (dataArray[i] - 128) / 128;
  sum += n * n;
}
const rms = Math.sqrt(sum / dataArray.length);
// 0~1로 정규화하여 서버로 전송
```

### 3.5 서버 통신
- **옵션 A:** WebSocket — 실시간 양방향
- **옵션 B:** REST — `POST /analyze`에 이미지 + noise_level

---

## 4. Phase 2 — 백엔드 (FastAPI)

### 4.1 main.py 골격

```python
from fastapi import FastAPI, WebSocket, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()

# 정적 파일 (프론트엔드)
app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/")
async def root():
    return FileResponse("frontend/index.html")

@app.post("/analyze")
async def analyze_frame(image: UploadFile, noise_level: float = 0.0):
    # 1. 이미지 바이트 읽기
    # 2. emotion_engine.detect_emotion() 호출
    # 3. occupancy.update()
    # 4. policy.decide_state()
    # 5. tapo_controller.apply_scene()
    # 6. face_boxes, percentages, state, light 반환
    pass
```

### 4.2 emotion_engine.py
- `vision_tapo_social_intervention_light.py`의 `detect_emotion_scores`, `remap_face_percentages`, `average_scores` 이식
- 입력: 이미지 바이트 (JPEG)
- 출력: `List[FaceDisplay]`, `avg_scores`, `people_count`

### 4.3 policy.py
- `decide_state`, `STATE_SCENES`, `build_scene` 이식

### 4.4 occupancy.py
- `OccupancyTracker` 클래스 그대로 이식

### 4.5 tapo_controller.py
- `TapoLightController` 이식
- **주의:** Tapo 전용 라이브러리 필요 시 `PyP100` 등으로 교체

---

## 5. Phase 3 — Tapo 제어

### 5.1 python-kasa vs Tapo
- `python-kasa`: Kasa 제품 위주. Tapo 지원 여부 확인 필요.
- Tapo 전용: [plugp100](https://github.com/petretiandrea/plugp100), [PyP100](https://github.com/K4L3/PyP100) 등

### 5.2 제어 시점
- 상태가 바뀔 때만 `apply_scene()` 호출
- 매 프레임마다 호출하지 않기

---

## 6. Phase 4 — UI 오버레이

### 6.1 서버 응답 예시

```json
{
  "faces": [
    {
      "box": [100, 80, 200, 180],
      "percentages": {"Joy": 45, "Sorrow": 10, "Anger": 5, "Surprise": 15, "Neutral": 25}
    }
  ],
  "people_count": 1,
  "noise_level": "medium",
  "occupancy_time": 18.5,
  "state": "observed_crowd",
  "light": {"brightness": 65, "color_temp": 4200}
}
```

### 6.2 프론트엔드 렌더링
- `canvas`에 `drawImage(video)` 후
- 각 face의 `box`에 `strokeRect` 그리기
- 박스 오른쪽에 `percentages` 텍스트 (Joy, Sorrow, Anger, Surprise, Neutral)
- 하단 패널에 PEOPLE DETECTED, NOISE LEVEL, OCCUPANCY TIME, SYSTEM MODE, LIGHT 표시

### 6.3 톤
- 모니터링 대시보드 스타일
- `ENVIRONMENTAL ADJUSTMENT IN PROGRESS`, `BASED ON COLLECTIVE EMOTIONAL DATA` 등 문구 사용
- 모든 텍스트 영어

---

## 7. 실행 순서

### 7.1 데스크톱에서 서버 실행

```powershell
cd "c:\Users\user\Desktop\Spatial Environment Agent"
$env:GOOGLE_APPLICATION_CREDENTIALS = "path\to\key.json"
$env:TAPO_USERNAME = "your@email.com"
$env:TAPO_PASSWORD = "your_password"
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### 7.2 데스크톱 IP 확인

```powershell
ipconfig | findstr "IPv4"
# 예: 192.168.0.10
```

### 7.3 태블릿에서 접속
- Chrome 브라우저에서 `http://192.168.0.10:8000` 접속
- 카메라·마이크 권한 허용
- 라이브 미리보기 + 오버레이 확인

---

## 8. requirements.txt (예시)

```text
fastapi>=0.109.0
uvicorn[standard]>=0.27.0
python-multipart>=0.0.6
google-cloud-vision>=3.7.4
python-kasa>=0.7.0
numpy>=1.26.4
pydantic>=2.0
```

- `opencv-python`, `sounddevice`는 서버에서 제거 (입력은 브라우저에서)

---

## 9. 체크리스트

- [ ] Google Cloud Vision API 활성화 및 인증
- [ ] Tapo 계정·IP 설정
- [ ] FastAPI 서버 구동
- [ ] 프론트엔드에서 카메라·마이크 캡처
- [ ] 프레임 + 노이즈 레벨 서버 전송
- [ ] 얼굴 박스·감정 퍼센트 오버레이
- [ ] 4가지 상태에 따른 Tapo 조명 제어
- [ ] 데스크톱과 태블릿이 같은 Wi-Fi에 연결됨

---

## 10. 참고 링크

- [Google Cloud Vision API - Face Detection](https://cloud.google.com/vision/docs/detecting-faces)
- [Web Audio API - AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode)
- [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [FastAPI](https://fastapi.tiangolo.com/)
