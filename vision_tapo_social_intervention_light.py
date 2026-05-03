import asyncio
import os
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Tuple

import cv2
import numpy as np
import sounddevice as sd
from google.cloud import vision
from kasa import Discover, Module

# =========================
# User settings
# =========================
TAPO_USERNAME = os.getenv("TAPO_USERNAME", "your_tapo_email@example.com")
TAPO_PASSWORD = os.getenv("TAPO_PASSWORD", "your_tapo_password")
TAPO_IPS = [ip.strip() for ip in os.getenv("TAPO_IPS", "192.168.0.21").split(",") if ip.strip()]

CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
ANALYZE_EVERY_SEC = float(os.getenv("ANALYZE_EVERY_SEC", "1.2"))
HISTORY_SIZE = int(os.getenv("HISTORY_SIZE", "5"))
ABSENCE_GRACE_SEC = float(os.getenv("ABSENCE_GRACE_SEC", "2.0"))
CAPACITY = int(os.getenv("CAPACITY", "6"))

# Microphone
AUDIO_DEVICE = os.getenv("AUDIO_DEVICE")
AUDIO_BLOCKSIZE = int(os.getenv("AUDIO_BLOCKSIZE", "1024"))
NOISE_HISTORY_SIZE = int(os.getenv("NOISE_HISTORY_SIZE", "20"))
NOISE_LOW_THRESHOLD = float(os.getenv("NOISE_LOW_THRESHOLD", "0.015"))
NOISE_HIGH_THRESHOLD = float(os.getenv("NOISE_HIGH_THRESHOLD", "0.045"))

WINDOW_TITLE = "AI Social Intervention -> Tapo Light"

STATE_SCENES: Dict[str, Dict[str, int]] = {
    "idle": {"brightness": 55, "color_temp": 4000},
    "observed_crowd": {"brightness": 65, "color_temp": 4200},
    "managed_stress": {"brightness": 50, "color_temp": 3000},
    "algorithmic_activation": {"brightness": 75, "color_temp": 4600},
}

EMOTION_ORDER = ["Joy", "Sorrow", "Anger", "Surprise", "Neutral"]
EMOTION_COLORS = {
    "Joy": (90, 230, 255),
    "Sorrow": (255, 180, 80),
    "Anger": (80, 80, 255),
    "Surprise": (255, 255, 255),
    "Neutral": (180, 220, 180),
}

LIKELIHOOD_TO_SCORE = {
    0: 0,  # UNKNOWN
    1: 1,  # VERY_UNLIKELY
    2: 2,  # UNLIKELY
    3: 3,  # POSSIBLE
    4: 4,  # LIKELY
    5: 5,  # VERY_LIKELY
}


@dataclass(frozen=True)
class LightScene:
    label: str
    brightness: int
    color_temp: Optional[int]


@dataclass
class FaceDisplay:
    box: Tuple[int, int, int, int]
    scores: Dict[str, int]
    percentages: Dict[str, int]
    dominant_label: str


@dataclass
class SpatialMetrics:
    people_count: int
    occupancy_duration: float
    crowding: float
    noise_rms: float
    noise_level: str
    noise_score: float
    avg_scores: Dict[str, float]
    mood_score: float
    stress_score: float
    state_label: str


def clamp(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(value, max_value))


class AudioLevelMonitor:
    def __init__(self, device: Optional[str] = None):
        self.device = device
        self.history: Deque[float] = deque(maxlen=NOISE_HISTORY_SIZE)
        self.stream: Optional[sd.InputStream] = None

    def _audio_callback(self, indata, frames, callback_time, status):
        if status:
            return
        rms = float(np.sqrt(np.mean(np.square(indata))))
        self.history.append(rms)

    def start(self):
        self.stream = sd.InputStream(
            device=self.device,
            channels=1,
            samplerate=16000,
            blocksize=AUDIO_BLOCKSIZE,
            callback=self._audio_callback,
        )
        self.stream.start()

    def stop(self):
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None

    def get_noise_rms(self) -> float:
        if not self.history:
            return 0.0
        return float(sum(self.history) / len(self.history))


def classify_noise_level(rms: float) -> Tuple[str, float]:
    if rms < NOISE_LOW_THRESHOLD:
        score = rms / max(NOISE_LOW_THRESHOLD, 1e-6) * 0.4
        return "low", min(score, 0.4)
    if rms < NOISE_HIGH_THRESHOLD:
        span = max(NOISE_HIGH_THRESHOLD - NOISE_LOW_THRESHOLD, 1e-6)
        ratio = (rms - NOISE_LOW_THRESHOLD) / span
        return "medium", 0.4 + ratio * 0.4
    capped = min(rms, NOISE_HIGH_THRESHOLD * 2.0)
    ratio = (capped - NOISE_HIGH_THRESHOLD) / max(NOISE_HIGH_THRESHOLD, 1e-6)
    return "high", min(0.8 + ratio * 0.2, 1.0)


def get_face_box(face) -> Tuple[int, int, int, int]:
    xs = [v.x for v in face.bounding_poly.vertices if v.x is not None]
    ys = [v.y for v in face.bounding_poly.vertices if v.y is not None]
    if not xs or not ys:
        return (0, 0, 0, 0)
    return min(xs), min(ys), max(xs), max(ys)


def bounding_area(face) -> int:
    x1, y1, x2, y2 = get_face_box(face)
    return max(0, (x2 - x1) * (y2 - y1))


def compute_percentages_to_100(raw_scores: Dict[str, float]) -> Dict[str, int]:
    total = float(sum(max(v, 0.0) for v in raw_scores.values()))
    if total <= 0:
        return {name: (100 if name == "Neutral" else 0) for name in EMOTION_ORDER}

    exact = {name: (max(raw_scores.get(name, 0.0), 0.0) / total) * 100.0 for name in EMOTION_ORDER}
    floored = {name: int(np.floor(exact[name])) for name in EMOTION_ORDER}
    remainder = 100 - sum(floored.values())

    if remainder > 0:
        ranked = sorted(EMOTION_ORDER, key=lambda n: (exact[n] - floored[n]), reverse=True)
        for i in range(remainder):
            floored[ranked[i % len(ranked)]] += 1

    return floored


def remap_face_percentages(scores: Dict[str, int]) -> Dict[str, int]:
    raw = {
        "Joy": float(max(scores.get("joy", 0), 0)),
        "Sorrow": float(max(scores.get("sorrow", 0), 0)),
        "Anger": float(max(scores.get("anger", 0), 0)),
        "Surprise": float(max(scores.get("surprise", 0), 0)),
    }
    raw["Neutral"] = float(max(0, 5 - max(raw.values(), default=0.0)))
    return compute_percentages_to_100(raw)


def average_scores(history: Deque[Dict[str, int]]) -> Dict[str, float]:
    if not history:
        return {"joy": 0.0, "sorrow": 0.0, "anger": 0.0, "surprise": 0.0}

    totals = {"joy": 0.0, "sorrow": 0.0, "anger": 0.0, "surprise": 0.0}
    for item in history:
        for key in totals:
            totals[key] += item[key]

    size = len(history)
    return {key: totals[key] / size for key in totals}


def detect_emotion_scores(
    vision_client: vision.ImageAnnotatorClient,
    frame_bgr,
) -> Tuple[Dict[str, int], int, List[FaceDisplay]]:
    ok, encoded = cv2.imencode(".jpg", frame_bgr)
    if not ok:
        raise RuntimeError("Could not encode webcam frame as JPEG.")

    image = vision.Image(content=encoded.tobytes())
    response = vision_client.face_detection(image=image)

    if response.error.message:
        raise RuntimeError(f"Cloud Vision API error: {response.error.message}")

    faces = response.face_annotations
    if not faces:
        return {"joy": 0, "sorrow": 0, "anger": 0, "surprise": 0}, 0, []

    face_displays: List[FaceDisplay] = []
    for face in faces:
        scores = {
            "joy": LIKELIHOOD_TO_SCORE.get(face.joy_likelihood, 0),
            "sorrow": LIKELIHOOD_TO_SCORE.get(face.sorrow_likelihood, 0),
            "anger": LIKELIHOOD_TO_SCORE.get(face.anger_likelihood, 0),
            "surprise": LIKELIHOOD_TO_SCORE.get(face.surprise_likelihood, 0),
        }
        percentages = remap_face_percentages(scores)
        dominant_label = max(percentages, key=percentages.get)
        face_displays.append(
            FaceDisplay(
                box=get_face_box(face),
                scores=scores,
                percentages=percentages,
                dominant_label=dominant_label,
            )
        )

    primary_face = max(faces, key=bounding_area)
    primary_scores = {
        "joy": LIKELIHOOD_TO_SCORE.get(primary_face.joy_likelihood, 0),
        "sorrow": LIKELIHOOD_TO_SCORE.get(primary_face.sorrow_likelihood, 0),
        "anger": LIKELIHOOD_TO_SCORE.get(primary_face.anger_likelihood, 0),
        "surprise": LIKELIHOOD_TO_SCORE.get(primary_face.surprise_likelihood, 0),
    }
    return primary_scores, len(faces), face_displays


class OccupancyTracker:
    def __init__(self, grace_sec: float):
        self.grace_sec = grace_sec
        self.occupied = False
        self.occupancy_start: Optional[float] = None
        self.last_seen_time: Optional[float] = None

    def update(self, face_count: int, now: float) -> float:
        if face_count > 0:
            if not self.occupied:
                self.occupied = True
                self.occupancy_start = now
            self.last_seen_time = now
            return now - (self.occupancy_start or now)

        if self.occupied and self.last_seen_time is not None:
            if now - self.last_seen_time <= self.grace_sec:
                return now - (self.occupancy_start or now)
            self.occupied = False
            self.occupancy_start = None
            self.last_seen_time = None

        return 0.0


def decide_state(
    people_count: int,
    occupancy_duration: float,
    avg_scores: Dict[str, float],
    noise_score: float,
) -> Tuple[str, float, float, float]:
    crowding = min(people_count / max(CAPACITY, 1), 1.0)

    joy_n = avg_scores["joy"] / 5.0
    sorrow_n = avg_scores["sorrow"] / 5.0
    anger_n = avg_scores["anger"] / 5.0
    surprise_n = avg_scores["surprise"] / 5.0

    stress_score = anger_n + surprise_n + noise_score * 0.5
    mood_score = joy_n - sorrow_n

    if people_count == 0 or occupancy_duration < 3.0:
        return "idle", crowding, mood_score, stress_score
    if stress_score > 0.8 or noise_score >= 0.8:
        return "managed_stress", crowding, mood_score, stress_score
    if mood_score < -0.3:
        return "algorithmic_activation", crowding, mood_score, stress_score
    return "observed_crowd", crowding, mood_score, stress_score


class TapoLightController:
    def __init__(self, ip: str, device, light_module):
        self.ip = ip
        self.device = device
        self.light = light_module
        self.last_scene: Optional[LightScene] = None
        self.temp_min: Optional[int] = None
        self.temp_max: Optional[int] = None

        color_temp_feature = self.light.get_feature("color_temp")
        if color_temp_feature:
            self.temp_min = color_temp_feature.minimum_value
            self.temp_max = color_temp_feature.maximum_value

    @classmethod
    async def connect(cls, ip: str, username: str, password: str):
        device = await Discover.discover_single(ip, username=username, password=password)
        await device.update()

        if Module.Light not in device.modules:
            raise RuntimeError(f"{ip} device has no light module: {device.model}")

        light = device.modules[Module.Light]
        if not light.has_feature("brightness"):
            raise RuntimeError(f"{ip} device does not support brightness control: {device.model}")

        return cls(ip, device, light)

    async def apply_scene(self, scene: LightScene):
        if scene == self.last_scene:
            return

        brightness = clamp(scene.brightness, 1, 100)
        await self.device.turn_on()

        if scene.color_temp is not None and self.light.has_feature("color_temp"):
            temp = scene.color_temp
            if self.temp_min is not None and self.temp_max is not None:
                temp = clamp(temp, self.temp_min, self.temp_max)
            await self.light.set_color_temp(temp, brightness=brightness)
        else:
            await self.light.set_brightness(brightness)

        self.last_scene = LightScene(label=scene.label, brightness=brightness, color_temp=scene.color_temp)


async def connect_all_lights() -> List[TapoLightController]:
    controllers: List[TapoLightController] = []
    for ip in TAPO_IPS:
        controller = await TapoLightController.connect(ip, TAPO_USERNAME, TAPO_PASSWORD)
        controllers.append(controller)
    return controllers


def build_scene(state_label: str) -> LightScene:
    config = STATE_SCENES[state_label]
    return LightScene(
        label=state_label,
        brightness=config["brightness"],
        color_temp=config.get("color_temp"),
    )


def draw_box_and_emotions(frame, face_info: FaceDisplay):
    x1, y1, x2, y2 = face_info.box
    if x2 <= x1 or y2 <= y1:
        return

    cv2.rectangle(frame, (x1, y1), (x2, y2), (120, 255, 120), 2)

    lines = [f"{name}: {face_info.percentages[name]}%" for name in EMOTION_ORDER]

    text_x = x2 + 12
    line_height = 22
    panel_width = 160
    panel_height = 10 + line_height * len(lines)

    if text_x + panel_width > frame.shape[1] - 10:
        text_x = max(10, x1 - panel_width - 12)

    text_y = max(16, y1)
    if text_y + panel_height > frame.shape[0] - 10:
        text_y = max(10, frame.shape[0] - panel_height - 10)

    cv2.rectangle(
        frame,
        (text_x - 6, text_y - 16),
        (text_x + panel_width, text_y - 16 + panel_height),
        (20, 20, 20),
        -1,
    )
    cv2.rectangle(
        frame,
        (text_x - 6, text_y - 16),
        (text_x + panel_width, text_y - 16 + panel_height),
        (120, 255, 120),
        1,
    )

    for idx, line in enumerate(lines):
        emotion_name = EMOTION_ORDER[idx]
        y = text_y + idx * line_height
        cv2.putText(
            frame,
            line,
            (text_x, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.56,
            EMOTION_COLORS[emotion_name],
            2,
            cv2.LINE_AA,
        )


def draw_overlay(frame, metrics: SpatialMetrics, face_displays: List[FaceDisplay]):
    scene = STATE_SCENES[metrics.state_label]

    for face_info in face_displays:
        draw_box_and_emotions(frame, face_info)

    lines = [
        f"State: {metrics.state_label}",
        f"Faces: {metrics.people_count} | Occupancy: {metrics.occupancy_duration:4.1f}s",
        f"Noise: {metrics.noise_level} ({metrics.noise_rms:.4f}) | Crowding: {metrics.crowding:.2f}",
        (
            f"joy={metrics.avg_scores['joy']:.2f} "
            f"sorrow={metrics.avg_scores['sorrow']:.2f} "
            f"anger={metrics.avg_scores['anger']:.2f} "
            f"surprise={metrics.avg_scores['surprise']:.2f}"
        ),
        f"mood={metrics.mood_score:.2f} | stress={metrics.stress_score:.2f}",
        f"Light: {scene['brightness']}% / {scene['color_temp']}K",
        "Press q or ESC to quit",
    ]

    panel_x, panel_y = 10, 10
    panel_w, panel_h = 650, 205
    cv2.rectangle(frame, (panel_x, panel_y), (panel_x + panel_w, panel_y + panel_h), (15, 15, 15), -1)
    cv2.rectangle(frame, (panel_x, panel_y), (panel_x + panel_w, panel_y + panel_h), (180, 180, 180), 1)

    y = 36
    for line in lines:
        cv2.putText(
            frame,
            line,
            (22, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.68,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        y += 28


async def main():
    if TAPO_USERNAME.startswith("your_") or TAPO_PASSWORD == "your_tapo_password":
        raise RuntimeError("Set TAPO_USERNAME and TAPO_PASSWORD first.")

    print("[1/5] Preparing Cloud Vision client...")
    vision_client = vision.ImageAnnotatorClient()

    print("[2/5] Connecting to Tapo lights...")
    controllers = await connect_all_lights()
    for controller in controllers:
        temp_info = (
            f"{controller.temp_min}~{controller.temp_max}K"
            if controller.temp_min is not None and controller.temp_max is not None
            else "color_temp unsupported"
        )
        print(f"  - {controller.ip}: brightness OK / {temp_info}")

    print("[3/5] Starting microphone stream...")
    audio_monitor = AudioLevelMonitor(device=AUDIO_DEVICE or None)
    audio_monitor.start()

    print("[4/5] Opening webcam...")
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        audio_monitor.stop()
        raise RuntimeError(f"Could not open webcam index {CAMERA_INDEX}.")

    print("[5/5] Running. Press q or ESC to quit.")
    emotion_history: Deque[Dict[str, int]] = deque(maxlen=HISTORY_SIZE)
    occupancy_tracker = OccupancyTracker(grace_sec=ABSENCE_GRACE_SEC)

    current_state = "idle"
    face_count = 0
    avg_scores = {"joy": 0.0, "sorrow": 0.0, "anger": 0.0, "surprise": 0.0}
    metrics = SpatialMetrics(
        people_count=0,
        occupancy_duration=0.0,
        crowding=0.0,
        noise_rms=0.0,
        noise_level="low",
        noise_score=0.0,
        avg_scores=avg_scores,
        mood_score=0.0,
        stress_score=0.0,
        state_label="idle",
    )
    last_analyzed_at = 0.0
    face_displays: List[FaceDisplay] = []

    try:
        scene = build_scene(current_state)
        for controller in controllers:
            await controller.apply_scene(scene)

        while True:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("Could not read a frame from the webcam.")

            now = time.monotonic()
            if now - last_analyzed_at >= ANALYZE_EVERY_SEC:
                raw_scores, face_count, face_displays = detect_emotion_scores(vision_client, frame)
                emotion_history.append(raw_scores)
                avg_scores = average_scores(emotion_history)

                occupancy_duration = occupancy_tracker.update(face_count=face_count, now=now)
                noise_rms = audio_monitor.get_noise_rms()
                noise_level, noise_score = classify_noise_level(noise_rms)

                state_label, crowding, mood_score, stress_score = decide_state(
                    people_count=face_count,
                    occupancy_duration=occupancy_duration,
                    avg_scores=avg_scores,
                    noise_score=noise_score,
                )

                metrics = SpatialMetrics(
                    people_count=face_count,
                    occupancy_duration=occupancy_duration,
                    crowding=crowding,
                    noise_rms=noise_rms,
                    noise_level=noise_level,
                    noise_score=noise_score,
                    avg_scores=avg_scores,
                    mood_score=mood_score,
                    stress_score=stress_score,
                    state_label=state_label,
                )

                if state_label != current_state:
                    scene = build_scene(state_label)
                    for controller in controllers:
                        await controller.apply_scene(scene)
                    print(
                        f"[{time.strftime('%H:%M:%S')}] {current_state} -> {state_label} | "
                        f"faces={face_count}, noise={noise_level}, occupancy={occupancy_duration:.1f}s, "
                        f"brightness={scene.brightness}, color_temp={scene.color_temp}"
                    )
                    current_state = state_label

                last_analyzed_at = now

            draw_overlay(frame, metrics, face_displays)
            cv2.imshow(WINDOW_TITLE, frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q")):
                break

            await asyncio.sleep(0.01)
    finally:
        cap.release()
        cv2.destroyAllWindows()
        audio_monitor.stop()


if __name__ == "__main__":
    asyncio.run(main())
