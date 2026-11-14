"""Metrics from visibility masks: hours, windows, time to the next change.

Resolution is the table step (10 min in our exports): a window starts at the first
sample where the body is up and ends at the first sample where it is down again.
Windows touching the edge of the data are marked open (we do not know what is beyond).
"""
from __future__ import annotations

import numpy as np

from .combine import Visibility


def _iso(t) -> str:
    return str(np.datetime64(t, "s")) + "Z"


def hours(mask: np.ndarray, step_s: int) -> float:
    return float(np.count_nonzero(mask)) * step_s / 3600.0


def windows(mask: np.ndarray, times: np.ndarray, step_s: int):
    out = []
    n = len(mask)
    i = 0
    while i < n:
        if not mask[i]:
            i += 1
            continue
        j = i
        while j < n and mask[j]:
            j += 1
        end = times[j] if j < n else times[-1] + np.timedelta64(step_s, "s")
        out.append({"start": _iso(times[i]), "end": _iso(end),
                    "hours": (j - i) * step_s / 3600.0,
                    "open_start": i == 0, "open_end": j == n})
        i = j
    return out


def next_change(mask: np.ndarray, times: np.ndarray, t):
    """(state at t, minutes until the state changes or None if it does not within the data)."""
    t = np.datetime64(t, "s")
    if t < times[0] or t > times[-1]:
        raise ValueError("time outside the data")
    i = int(np.searchsorted(times, t, side="right")) - 1
    state = bool(mask[i])
    for j in range(i + 1, len(mask)):
        if bool(mask[j]) != state:
            return state, float((times[j] - t) / np.timedelta64(1, "m"))
    return state, None


def summary(vis: Visibility) -> dict:
    step_s = int((vis.times[1] - vis.times[0]) / np.timedelta64(1, "s"))
    return {
        "terrain": vis.terrain,
        "earth_reference": "upper limb" if vis.earth_limb else "centre",
        "step_minutes": step_s / 60.0,
        "span_hours": len(vis.times) * step_s / 3600.0,
        "sun_hours": hours(vis.sun_up, step_s),
        "earth_hours": hours(vis.earth_up, step_s),
        "joint_hours": hours(vis.both, step_s),
        "sun_windows": windows(vis.sun_up, vis.times, step_s),
        "earth_windows": windows(vis.earth_up, vis.times, step_s),
        "joint_windows": windows(vis.both, vis.times, step_s),
    }
