"""Configuration for Emotional Space AI backend."""
import os

# Vision API 비용 절감: False면 컨트롤 화면에서 지정한 값 사용
USE_VISION_API = os.getenv("USE_VISION_API", "false").lower() in ("1", "true", "yes")

TAPO_USERNAME = os.getenv("TAPO_USERNAME", "your_tapo_email@example.com")
TAPO_PASSWORD = os.getenv("TAPO_PASSWORD", "your_tapo_password")
TAPO_IPS = [ip.strip() for ip in os.getenv("TAPO_IPS", "192.168.1.100").split(",") if ip.strip()]

ANALYZE_EVERY_SEC = float(os.getenv("ANALYZE_EVERY_SEC", "1.2"))
HISTORY_SIZE = int(os.getenv("HISTORY_SIZE", "5"))
ABSENCE_GRACE_SEC = float(os.getenv("ABSENCE_GRACE_SEC", "2.0"))
CAPACITY = int(os.getenv("CAPACITY", "6"))

# Noise: frontend sends 0~1, map to score
NOISE_LOW_THRESHOLD = 0.015
NOISE_HIGH_THRESHOLD = 0.045

STATE_SCENES = {
    "idle": {"brightness": 55, "color_temp": 4000},
    "observed_crowd": {"brightness": 65, "color_temp": 4200},
    "managed_stress": {"brightness": 50, "color_temp": 3000},
    "algorithmic_activation": {"brightness": 75, "color_temp": 4600},
}

# 마이크 입력(noise_level)에 따른 백색소음 기본값
WHITE_NOISE_RULE = [
    {"max_raw": 0.4, "volume": 0, "reason": "조용함"},
    {"max_raw": 0.8, "volume": 40, "reason": "중간 소음"},
    {"max_raw": 1.0, "volume": 80, "reason": "높은 소음"},
]
# 상태별 백색소음 보정 (안정화/활성화 목적)
WHITE_NOISE_STATE_BONUS = {
    "idle": 0,
    "observed_crowd": 5,
    "managed_stress": 25,  # 개입 시 — 안정화용 추가
    "algorithmic_activation": 15,  # 활성화 시 — 분위기 전환
}

EMOTION_ORDER = ["Joy", "Sorrow", "Anger", "Surprise", "Neutral"]

LIKELIHOOD_TO_SCORE = {
    0: 0,  # UNKNOWN
    1: 1,  # VERY_UNLIKELY
    2: 2,  # UNLIKELY
    3: 3,  # POSSIBLE
    4: 4,  # LIKELY
    5: 5,  # VERY_LIKELY
}
