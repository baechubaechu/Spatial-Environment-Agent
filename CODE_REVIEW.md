# Emotional Space AI — 코드 리뷰

> `cursor_handoff_emotional_space_ai.md` 요구사항 대비 `vision_tapo_social_intervention_light.py` 분석

---

## 1. 요약

현재 코드는 **데스크톱 웹캠/마이크** 기반의 단일 스크립트입니다.  
MD 문서가 요구하는 **태블릿 브라우저 입력 + 데스크톱 서버** 아키텍처와는 구조가 다릅니다.

| 항목 | MD 요구사항 | 현재 구현 | 일치 여부 |
|------|-------------|-----------|------------|
| 입력 소스 | Android 태블릿 브라우저 (카메라+마이크) | 데스크톱 웹캠/마이크 | ❌ |
| UI | 브라우저 웹 페이지 | OpenCV `imshow` | ❌ |
| 아키텍처 | FastAPI + WebSocket | 단일 Python 스크립트 | ❌ |
| 모듈 분리 | backend/, frontend/ 분리 | 단일 파일 (~440줄) | ❌ |
| 감정 분석 | Google Cloud Vision | ✅ 구현됨 | ✅ |
| recent-5 평균 | 5프레임 평균 | ✅ 구현됨 | ✅ |
| 4가지 상태 | idle, observed_crowd, managed_stress, algorithmic_activation | ✅ 구현됨 | ✅ |
| Tapo 조명 제어 | brightness + color_temp | ✅ 구현됨 | ✅ |
| occupancy 로직 | grace period 포함 | ✅ 구현됨 | ✅ |

---

## 2. 잘 구현된 부분

### 2.1 감정 처리 파이프라인
- `LIKELIHOOD_TO_SCORE` 매핑: Google Vision API 응답을 0~5 점수로 변환
- `neutral = max(0, 5 - max(joy, sorrow, anger, surprise))` 로직 정확히 반영
- `compute_percentages_to_100()`: 합계 100% 보장 (나머지 분배)
- `average_scores()`: recent-5 평균화

### 2.2 정책(State) 로직
- `decide_state()`: 우선순위 1) idle → 2) managed_stress → 3) algorithmic_activation → 4) observed_crowd
- `stress = anger + surprise + noise*0.5`, `mood = joy - sorrow` 수식 반영
- `STATE_SCENES` 밝기/색온도 값 문서와 일치

### 2.3 Occupancy 추적
- `OccupancyTracker`: grace period(2초)로 일시적 감지 실패 허용
- `people_count >= 1` 시 occupancy 시작, 3초 미만이면 idle

### 2.4 Tapo 제어
- `TapoLightController`: brightness, color_temp 지원
- 상태 변경 시에만 조명 업데이트 (불필요한 API 호출 방지)

### 2.5 노이즈 분류
- `classify_noise_level()`: low/medium/high + 0~1 스코어
- `AudioLevelMonitor`: RMS 기반 볼륨 측정

---

## 3. 수정/보완이 필요한 부분

### 3.1 아키텍처 전환 (필수)

**현재:** 데스크톱에서 `cv2.VideoCapture`, `sounddevice` 직접 사용  
**요구:** 태블릿 브라우저에서 `getUserMedia`로 캡처 → 서버로 전송

**필요 작업:**
- FastAPI 서버 구축
- WebSocket 또는 REST로 프레임/오디오 레벨 수신
- 프론트엔드(HTML/CSS/JS)에서 카메라·마이크 캡처 및 전송

### 3.2 Tapo 라이브러리 호환성

**현재:** `python-kasa` (Kasa 스마트홈용)  
**참고:** Tapo는 TP-Link의 별도 제품군. `python-kasa`가 Tapo를 지원하는지 확인 필요.

- 지원하지 않을 경우: `PyP100`, `plugp100` 등 Tapo 전용 라이브러리 검토
- 또는 Tapo 공식 API/클라우드 연동 확인

### 3.3 모듈 분리

MD 권장 구조:

```
emotion-ai-space/
├─ backend/
│  ├─ main.py           # FastAPI app
│  ├─ config.py
│  ├─ emotion_engine.py # Vision API 파싱
│  ├─ policy.py         # 상태 결정 + 조명 정책
│  ├─ occupancy.py      # occupancy 타이머
│  ├─ audio_utils.py    # 노이즈 정규화
│  ├─ tapo_controller.py
│  └─ models.py
├─ frontend/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
```

현재 로직을 위 모듈로 분리하면 유지보수와 테스트가 쉬워집니다.

### 3.4 UI 톤

**요구:** 모니터링/시스템 대시보드 느낌, 치료적·친근한 톤 금지  
**현재:** OpenCV 오버레이 — 기능은 있으나 브라우저 UI로 이전 필요

브라우저 UI에서:
- `PEOPLE DETECTED: 3`
- `NOISE LEVEL: MEDIUM`
- `OCCUPANCY TIME: 18s`
- `SYSTEM MODE: MANAGED_STRESS`
- `LIGHT: 3000K / 50%`
- `ENVIRONMENTAL ADJUSTMENT IN PROGRESS` 등 문구 사용

### 3.5 빈 얼굴 시 emotion_history

`detect_emotion_scores`가 faces가 없을 때 `{"joy": 0, ...}, 0, []`를 반환합니다.  
이 경우 `emotion_history.append(raw_scores)`로 0점 데이터가 쌓이므로,  
빈 프레임을 어떻게 처리할지(무시 vs. neutral만 추가) 정책을 명확히 하는 것이 좋습니다.

---

## 4. 재사용 가능한 코드 블록

다음 함수/클래스는 새 아키텍처에서 그대로 또는 약간의 수정으로 사용 가능합니다:

| 구성요소 | 용도 |
|----------|------|
| `remap_face_percentages`, `compute_percentages_to_100` | 감정 퍼센트 계산 |
| `average_scores` | recent-5 평균 |
| `decide_state` | 상태 결정 |
| `OccupancyTracker` | occupancy 시간 |
| `classify_noise_level` | 노이즈 분류 (서버에서 0~1 값 수신 시 사용) |
| `TapoLightController` | 조명 제어 (Tapo 호환 확인 후) |
| `get_face_box`, `bounding_area` | 얼굴 박스 처리 |

---

## 5. 결론

- **감정·정책·조명·occupancy 로직**은 MD 요구사항에 잘 맞게 구현되어 있음.
- **아키텍처**를 태블릿 브라우저 → 데스크톱 서버 구조로 전환하고,  
  **모듈 분리**와 **Tapo 호환성 확인**이 필요합니다.
