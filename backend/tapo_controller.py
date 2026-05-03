"""Tapo smart light control."""
from typing import List, Optional

from kasa import Discover, Module

from backend.config import TAPO_IPS, TAPO_PASSWORD, TAPO_USERNAME, STATE_SCENES


def clamp(value: int, min_val: int, max_val: int) -> int:
    return max(min_val, min(value, max_val))


class TapoLightController:
    def __init__(self, ip: str, device, light_module):
        self.ip = ip
        self.device = device
        self.light = light_module
        self.last_state: Optional[str] = None
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

    async def apply_state(self, state_label: str):
        if state_label == self.last_state:
            return

        config = STATE_SCENES.get(state_label, STATE_SCENES["idle"])
        brightness = clamp(config["brightness"], 1, 100)
        await self.device.turn_on()

        if config.get("color_temp") and self.light.has_feature("color_temp"):
            temp = config["color_temp"]
            if self.temp_min is not None and self.temp_max is not None:
                temp = clamp(temp, self.temp_min, self.temp_max)
            await self.light.set_color_temp(temp, brightness=brightness)
        else:
            await self.light.set_brightness(brightness)

        self.last_state = state_label


_controllers: Optional[List[TapoLightController]] = None


async def get_controllers() -> List[TapoLightController]:
    global _controllers
    if _controllers is None:
        _controllers = []
        for ip in TAPO_IPS:
            ctrl = await TapoLightController.connect(ip, TAPO_USERNAME, TAPO_PASSWORD)
            _controllers.append(ctrl)
    return _controllers


def reset_controllers():
    """Clear cached controllers (e.g. after network change)."""
    global _controllers
    _controllers = None


async def apply_light_state(state_label: str):
    try:
        controllers = await get_controllers()
        for ctrl in controllers:
            await ctrl.apply_state(state_label)
        print(f"Tapo: applied {state_label}")
    except Exception as e:
        print(f"Tapo error: {e}")
        reset_controllers()
        raise


async def turn_off_lights():
    """조명 끄기."""
    try:
        controllers = await get_controllers()
        for ctrl in controllers:
            await ctrl.device.turn_off()
            ctrl.last_state = None  # 다음 켜기 시 적용되도록
        print("Tapo: turned off")
    except Exception as e:
        print(f"Tapo error: {e}")
        reset_controllers()
        raise
