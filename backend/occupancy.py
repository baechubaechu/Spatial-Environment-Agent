"""Occupancy duration tracking."""
from typing import Optional


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
