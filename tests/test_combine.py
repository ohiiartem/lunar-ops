"""Checks for backend/calc/combine.py. The ephemeris numbers here are made up for testing only.

Run: .venv/bin/python tests/test_combine.py   (also works with pytest)
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.calc.combine import combine

PROFILE = {"azimuth_deg": [0.0, 90.0, 180.0, 270.0], "horizon_deg": [0.0, 1.5, 0.0, -2.0]}


def test_flat_horizon_means_visible_when_above_zero():
    out = combine(["a", "b"], [10, 10], [0.5, -0.5], [20, 20], [3.0, -1.0])
    assert out["sun_visible"] == [True, False]
    assert out["earth_visible"] == [True, False]
    assert out["both_visible"] == [True, False]
    assert out["terrain_used"] is False


def test_terrain_blocks_in_one_direction_only():
    # Sun 1.0 deg high: blocked in the east (terrain 1.5), visible in the west (terrain -2.0).
    out = combine(["a", "b"], [90.0, 270.0], [1.0, 1.0], [180.0, 180.0], [0.5, 0.5], profile=PROFILE)
    assert out["sun_visible"] == [False, True]
    assert out["earth_visible"] == [True, True]  # terrain 0.0 at south, Earth at 0.5 deg
    assert out["both_visible"] == [False, True]
    assert out["terrain_used"] is True


def test_sun_upper_limb_margin():
    # Sun center at 1.4 deg vs terrain 1.5: only the limb (0.27) makes it count as visible.
    out = combine(["a"], [90.0], [1.4], [0.0], [-5.0], profile=PROFILE)
    assert out["sun_visible"] == [True]
    out = combine(["a"], [90.0], [1.4], [0.0], [-5.0], profile=PROFILE, sun_limb_deg=0.0)
    assert out["sun_visible"] == [False]


def synthetic(n):
    """Fake ephemeris with n points, used only to measure JSON size."""
    i = np.arange(n)
    ph = 2 * np.pi * i / (n / 1.0)
    t = [f"2026-12-01T{(k // 60) % 24:02d}:{k % 60:02d}:00Z" for k in i]  # same length as real ISO times
    return t, 360 * (i / n * 30 % 1), 1.5 * np.sin(ph * 30), 360 * (i / n * 27 % 1), 8 * np.sin(ph * 25)


def json_size_kb(n):
    t, saz, salt, eaz, ealt = synthetic(n)
    return len(json.dumps(combine(t, saz, salt, eaz, ealt, profile=PROFILE))) / 1024


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
    print("\nJSON size of /api/timeseries answer:")
    for label, n in [("30 days, step 60 min", 30 * 24), ("30 days, step 30 min", 30 * 48),
                     ("30 days, step 10 min", 30 * 144), ("30 days, step 1 min", 30 * 1440),
                     ("1 year, step 60 min", 365 * 24), ("1 year, step 10 min", 365 * 144)]:
        print(f"  {label:24s} {n:7d} points  {json_size_kb(n):8.0f} KB")
