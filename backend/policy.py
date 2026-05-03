"""State policy and lighting rules."""
from typing import Dict, Tuple

from backend.config import CAPACITY, STATE_SCENES, WHITE_NOISE_RULE, WHITE_NOISE_STATE_BONUS


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


def get_light_config(state_label: str) -> dict:
    return STATE_SCENES.get(state_label, STATE_SCENES["idle"])


STATE_GOALS = {
    "idle": "Awaiting presence — no stable occupation yet",
    "observed_crowd": "Observing crowd — people present, low stress",
    "managed_stress": "Intervening — detected tension / overstimulation",
    "algorithmic_activation": "Activating — adjusting for low mood / stagnation",
}


def get_state_goal(state_label: str) -> str:
    return STATE_GOALS.get(state_label, "—")


def get_white_noise_config(
    noise_raw: float,
    state_label: str = None,
    stress_score: float = None,
) -> dict:
    """백색소음 출력: 마이크 + 상태 + 스트레스 보정."""
    for rule in WHITE_NOISE_RULE:
        if noise_raw <= rule["max_raw"]:
            base = rule["volume"]
            break
    else:
        base = 80

    state_bonus = WHITE_NOISE_STATE_BONUS.get(state_label or "idle", 0)
    stress_bonus = min(15, (stress_score or 0) * 20)  # 스트레스 높을수록 +0~15%
    volume = min(100, base + state_bonus + stress_bonus)

    parts = [f"마이크:{base}%"]
    if state_bonus:
        parts.append(f"상태:{state_bonus}%")
    if stress_bonus:
        parts.append(f"스트레스:{int(stress_bonus)}%")
    reason = " + ".join(parts) + f" = {volume}%"
    return {"volume": int(volume), "reason": reason}
