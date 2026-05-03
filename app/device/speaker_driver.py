from typing import Literal

Zone = Literal["zoneA", "zoneB", "all"]


class SpeakerDriver:
    def __init__(self) -> None:
        self.last_command: dict | None = None

    async def apply_scene(self, *, zone: Zone, track: str, volume: int, fade_ms: int) -> None:
        # TODO: speaker SDK or local player integration
        self.last_command = {
            "zone": zone,
            "track": track,
            "volume": volume,
            "fade_ms": fade_ms,
        }
