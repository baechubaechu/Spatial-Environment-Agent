"""Emotion detection via Google Cloud Vision API."""
from collections import deque
from typing import Deque, Dict, List, Tuple

from google.cloud import vision

from backend.config import EMOTION_ORDER, LIKELIHOOD_TO_SCORE, HISTORY_SIZE


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
    floored = {name: int(exact[name]) for name in EMOTION_ORDER}
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
    img_bytes: bytes,
) -> Tuple[Dict[str, int], int, List[dict]]:
    """Analyze image bytes, return (primary_scores, face_count, face_displays)."""
    image = vision.Image(content=img_bytes)
    response = vision_client.face_detection(image=image)

    if response.error.message:
        raise RuntimeError(f"Cloud Vision API error: {response.error.message}")

    faces = response.face_annotations
    if not faces:
        return {"joy": 0, "sorrow": 0, "anger": 0, "surprise": 0}, 0, []

    face_displays: List[dict] = []
    for face in faces:
        scores = {
            "joy": LIKELIHOOD_TO_SCORE.get(face.joy_likelihood, 0),
            "sorrow": LIKELIHOOD_TO_SCORE.get(face.sorrow_likelihood, 0),
            "anger": LIKELIHOOD_TO_SCORE.get(face.anger_likelihood, 0),
            "surprise": LIKELIHOOD_TO_SCORE.get(face.surprise_likelihood, 0),
        }
        percentages = remap_face_percentages(scores)
        dominant_label = max(percentages, key=percentages.get)
        face_displays.append({
            "box": list(get_face_box(face)),
            "scores": scores,
            "percentages": percentages,
            "dominant_label": dominant_label,
        })

    primary_face = max(faces, key=bounding_area)
    primary_scores = {
        "joy": LIKELIHOOD_TO_SCORE.get(primary_face.joy_likelihood, 0),
        "sorrow": LIKELIHOOD_TO_SCORE.get(primary_face.sorrow_likelihood, 0),
        "anger": LIKELIHOOD_TO_SCORE.get(primary_face.anger_likelihood, 0),
        "surprise": LIKELIHOOD_TO_SCORE.get(primary_face.surprise_likelihood, 0),
    }
    return primary_scores, len(faces), face_displays
