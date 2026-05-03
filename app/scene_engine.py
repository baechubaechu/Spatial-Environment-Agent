import os
from typing import Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, Field

Zone = Literal["zoneA", "zoneB", "all"]
Emotion = Literal["calm", "neutral", "active", "stressed"]


class LightPreset(BaseModel):
    brightness: int = Field(ge=0, le=100)
    color_temp: int = Field(ge=1500, le=9000)
    transition_ms: int = Field(ge=0, le=15000)


class SoundPreset(BaseModel):
    track: str
    volume: int = Field(ge=0, le=100)
    fade_ms: int = Field(ge=0, le=15000)


class DisplayPreset(BaseModel):
    """TV·모니터 시그니지 레이아웃 힌트(실제 픽셀은 수신측에서 해석)."""

    layout_id: str = "idle"
    headline: str = ""
    subtitle: str = ""


class Scene(BaseModel):
    id: str
    hold_sec: int = Field(ge=5, le=3600)
    target_zone: Zone = "all"
    light: LightPreset
    sound: SoundPreset
    display: Optional[DisplayPreset] = None


class SceneCatalog(BaseModel):
    safe_scene: str
    scenes: List[Scene]


class SensorState(BaseModel):
    people_count: int = Field(ge=0, le=300)
    decibel: float = Field(ge=0, le=160)
    emotion_state: Literal["calm", "neutral", "active", "stressed"]
    occupancy_zone: Zone = "all"


class ChatHint(BaseModel):
    intent_tag: str
    confidence: float = Field(ge=0, le=1)
    target_zone: Zone = "all"


class OverrideInput(BaseModel):
    people_count: Optional[int] = Field(default=None, ge=0, le=300)
    decibel: Optional[float] = Field(default=None, ge=0, le=160)
    emotion_state: Optional[Literal["calm", "neutral", "active", "stressed"]] = None
    duration_sec: Optional[int] = Field(default=None, ge=5, le=3600)
    profile_name: Optional[str] = None
    target_zone: Zone = "all"


class SceneDecision(BaseModel):
    scene_id: str
    hold_sec: int
    target_zone: Zone
    reason: str


class AutoRule(BaseModel):
    """sensor.state 한 건에 대해 위에서 아래로 첫 매칭만 적용."""

    id: str
    scene_id: str
    reason: str = "auto"
    match_all: bool = False
    people_min: Optional[int] = None
    people_max: Optional[int] = None
    decibel_min: Optional[float] = None
    decibel_max: Optional[float] = None
    emotion_in: Optional[List[Emotion]] = None

    def matches(self, sensor: SensorState) -> bool:
        if self.match_all:
            return True
        if self.people_min is not None and sensor.people_count < self.people_min:
            return False
        if self.people_max is not None and sensor.people_count > self.people_max:
            return False
        if self.decibel_min is not None and sensor.decibel < self.decibel_min:
            return False
        if self.decibel_max is not None and sensor.decibel > self.decibel_max:
            return False
        if self.emotion_in is not None and sensor.emotion_state not in self.emotion_in:
            return False
        has_constraint = (
            self.people_min is not None
            or self.people_max is not None
            or self.decibel_min is not None
            or self.decibel_max is not None
            or (self.emotion_in is not None and len(self.emotion_in) > 0)
        )
        return has_constraint


class AutoStrategyFile(BaseModel):
    version: int = 1
    rules: List[AutoRule]


def _default_auto_rules() -> List[AutoRule]:
    """config/auto_strategy.yaml 이 없을 때만 쓰는 내장 폴백."""
    return [
        AutoRule(id="builtin_loud", scene_id="dense_flux", reason="auto:loud", decibel_min=65.0),
        AutoRule(id="builtin_crowd", scene_id="dense_flux", reason="auto:crowd", people_min=4),
        AutoRule(id="builtin_stressed", scene_id="night_reflect", reason="auto:stressed", emotion_in=["stressed"]),
        AutoRule(id="builtin_active", scene_id="critical_focus", reason="auto:active", emotion_in=["active"]),
        AutoRule(
            id="builtin_calm_sparse",
            scene_id="calm_gallery",
            reason="auto:calm_sparse",
            people_max=3,
            decibel_max=52.0,
            emotion_in=["calm"],
        ),
        AutoRule(
            id="builtin_calm_group",
            scene_id="calm_gallery",
            reason="auto:calm_group",
            people_min=1,
            people_max=4,
            decibel_max=56.0,
            emotion_in=["calm"],
        ),
        AutoRule(
            id="builtin_neutral_browse",
            scene_id="critical_focus",
            reason="auto:neutral_browse",
            people_min=1,
            people_max=4,
            decibel_max=64.0,
            emotion_in=["neutral"],
        ),
        AutoRule(id="builtin_default", scene_id="calm_gallery", reason="auto:default", match_all=True),
    ]


def _load_auto_rules(strategy_path: str) -> List[AutoRule]:
    if not os.path.isfile(strategy_path):
        return _default_auto_rules()
    with open(strategy_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    parsed = AutoStrategyFile.model_validate(raw)
    rules = list(parsed.rules)
    if not rules:
        return _default_auto_rules()
    if not rules[-1].match_all:
        rules.append(
            AutoRule(
                id="auto_fallback",
                scene_id="calm_gallery",
                reason="auto:fallback",
                match_all=True,
            ),
        )
    return rules


class SceneEngine:
    def __init__(self, catalog: SceneCatalog, auto_rules: Optional[List[AutoRule]] = None):
        self.catalog = catalog
        self.scene_map: Dict[str, Scene] = {scene.id: scene for scene in catalog.scenes}
        self.auto_rules: List[AutoRule] = auto_rules if auto_rules is not None else _default_auto_rules()

    @classmethod
    def from_yaml(cls, scenes_path: str) -> "SceneEngine":
        with open(scenes_path, "r", encoding="utf-8") as f:
            catalog = SceneCatalog.model_validate(yaml.safe_load(f))
        config_dir = os.path.dirname(scenes_path)
        strategy_path = os.path.join(config_dir, "auto_strategy.yaml")
        auto_rules = _load_auto_rules(strategy_path)
        return cls(catalog, auto_rules)

    def safe_scene(self, target_zone: Zone = "all") -> SceneDecision:
        scene = self.scene_map.get(self.catalog.safe_scene)
        if scene is None:
            raise ValueError("safe scene is missing in catalog")
        return SceneDecision(
            scene_id=scene.id,
            hold_sec=scene.hold_sec,
            target_zone=target_zone,
            reason="safe_fallback",
        )

    def choose_scene(
        self,
        sensor: Optional[SensorState],
        chat_hint: Optional[ChatHint],
        override: Optional[OverrideInput],
    ) -> SceneDecision:
        if override is not None:
            return self._from_override(override)

        if sensor is not None:
            for rule in self.auto_rules:
                if rule.matches(sensor):
                    return self._pick(rule.scene_id, rule.reason, sensor.occupancy_zone)

        if chat_hint is not None and chat_hint.confidence >= 0.62:
            if "layer" in chat_hint.intent_tag or "section" in chat_hint.intent_tag:
                return self._pick("critical_focus", f"chat:{chat_hint.intent_tag}", chat_hint.target_zone)
            if "sound" in chat_hint.intent_tag:
                return self._pick("dense_flux", f"chat:{chat_hint.intent_tag}", chat_hint.target_zone)

        return self._pick("calm_gallery", "default", "all")

    def _from_override(self, override: OverrideInput) -> SceneDecision:
        if (override.decibel or 0) >= 65 or (override.people_count or 0) >= 4:
            return self._pick("dense_flux", "override:crowded", override.target_zone)
        if override.emotion_state == "stressed":
            return self._pick("night_reflect", "override:stressed", override.target_zone)
        if override.emotion_state == "active":
            return self._pick("critical_focus", "override:active", override.target_zone)
        return self._pick("calm_gallery", "override:default", override.target_zone)

    def _pick(self, scene_id: str, reason: str, zone: Zone) -> SceneDecision:
        scene = self.scene_map.get(scene_id)
        if scene is None:
            return self.safe_scene(zone)
        return SceneDecision(
            scene_id=scene.id,
            hold_sec=scene.hold_sec,
            target_zone=zone,
            reason=reason,
        )


def load_default_scene_engine() -> SceneEngine:
    base = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(base, "config", "scenes.yaml")
    return SceneEngine.from_yaml(path)
