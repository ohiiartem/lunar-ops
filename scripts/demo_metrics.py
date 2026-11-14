"""Demo of the core chain Combine -> Metrics with the real Site01 horizon profile.

WARNING: the Sun/Earth positions here are SYNTHETIC (made-up smooth curves), not JPL Horizons data.
They only show the output format. Real numbers appear once the Horizons table is loaded.

Usage: .venv/bin/python scripts/demo_metrics.py
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.calc.combine import combine  # noqa: E402
from backend.calc.metrics import analyze  # noqa: E402

profile = json.loads((ROOT / "backend/data/horizon_Site01.json").read_text())

# 30 days, 30-minute steps; Sun goes around once per ~29.5 days, altitude wobbles around ~1 deg.
n = 30 * 48
i = np.arange(n)
t = (np.datetime64("2026-12-01T00:00:00") + i * np.timedelta64(30, "m")).astype(str)
t = [s + "Z" for s in t]
sun_az = (i / (29.5 * 48) * 360) % 360
sun_alt = 1.0 + 1.5 * np.sin(2 * np.pi * i / (29.5 * 48) * 2)
earth_az = (60 + 20 * np.sin(2 * np.pi * i / (27.3 * 48))) % 360
earth_alt = 4 * np.sin(2 * np.pi * i / (27.3 * 48))

for label, prof in (("flat horizon (no terrain)", None), ("with LOLA terrain (Site01)", profile)):
    m = analyze(combine(t, sun_az, sun_alt, earth_az, earth_alt, profile=prof))
    print(f"\n=== SYNTHETIC DATA, {label} ===")
    print(f"light hours:          {m['light_hours']:.1f} of {m['period_hours']:.0f}")
    print(f"Earth visible hours:  {m['earth_visible_hours']:.1f}")
    print(f"both visible hours:   {m['both_hours']:.1f}")
    print(f"longest darkness:     {m['longest_darkness_hours']:.1f} h")
    print(f"sun status:           {m['sun_status']}, time to sunset: {m['time_to_sunset_h']}, to sunrise: {m['time_to_sunrise_h']}")
    print(f"Earth status:         {m['earth_status']}, time to Earth set: {m['time_to_earth_set_h']}")
    print(f"light windows ({len(m['light_windows'])}):", m["light_windows"][:3], "...")
