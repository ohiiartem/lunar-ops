"""Checks for backend/calc/metrics.py on hand-made visibility flags (30-minute steps).

Run: .venv/bin/python tests/test_metrics.py   (also works with pytest)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.calc.metrics import analyze


def series(sun, earth):
    n = len(sun)
    t = [f"2026-12-01T{(k * 30) // 60:02d}:{(k * 30) % 60:02d}:00Z" for k in range(n)]
    both = [a and b for a, b in zip(sun, earth)]
    return {"t": t, "sun_visible": sun, "earth_visible": earth, "both_visible": both, "terrain_used": True}


T, F = True, False


def test_hours_and_windows():
    # 8 samples = 4 h. Sun: T T F F T T T F  -> 5 samples lit = 2.5 h, two windows.
    s = series([T, T, F, F, T, T, T, F], [T, F, F, F, T, T, F, F])
    m = analyze(s)
    assert m["period_hours"] == 4.0
    assert m["light_hours"] == 2.5
    assert m["earth_visible_hours"] == 1.5
    assert m["both_hours"] == 1.5
    assert m["light_windows"] == [
        {"from": "2026-12-01T00:00:00Z", "to": "2026-12-01T01:00:00Z"},
        {"from": "2026-12-01T02:00:00Z", "to": "2026-12-01T03:30:00Z"},
    ]
    assert m["longest_darkness_hours"] == 1.0


def test_time_to_sunset_and_earth_set():
    s = series([T, T, T, F, F, T], [T, T, T, T, T, T])
    m = analyze(s)
    assert m["sun_status"] == "up_until_set" and m["time_to_sunset_h"] == 1.5
    assert m["earth_status"] == "up_all_period" and m["time_to_earth_set_h"] is None


def test_window_running_to_the_end_of_the_period():
    m = analyze(series([F, T, T], [F, F, F]))
    assert m["light_windows"] == [{"from": "2026-12-01T00:30:00Z", "to": "2026-12-01T01:30:00Z"}]
    assert m["light_hours"] == 1.0


def test_dark_at_start_gives_time_to_sunrise():
    m = analyze(series([F, F, F, T], [T, T, T, T]))
    assert m["sun_status"] == "down_until_rise" and m["time_to_sunrise_h"] == 1.5
    assert m["time_to_sunset_h"] is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
