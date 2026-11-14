"""Sanity checks of the real Horizons tables (no extra packages needed). Prints a report for docs/validation.md.

Checks per site that has backend/data/horizons_<id>.csv:
  1. Geometric ceiling: the Sun cannot be higher than 1.54 deg (lunar axial tilt) + angular distance of the site from the pole.
  2. Smoothness: no jump in Sun/Earth azimuth/altitude between neighbouring rows (a corrupted or shifted row would show up).
  3. Control case: moments where the Sun is above a flat horizon but hidden by terrain (and its time window).
Usage: .venv/bin/python scripts/validate_tables.py
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.calc.horizon import horizon_at  # noqa: E402

DATA = ROOT / "backend/data"
for s in json.loads((DATA / "sites.json").read_text()):
    path = DATA / f"horizons_{s['id']}.csv"
    if not path.exists():
        print(f"{s['id']}: no table, skipped")
        continue
    rows = list(csv.DictReader(open(path)))
    t = [r["t"] for r in rows]
    a = {k: np.array([float(r[k]) for r in rows]) for k in ("sun_az", "sun_alt", "earth_az", "earth_alt")}
    ceiling = 1.54 + (90 - abs(s["lat"]))
    print(f"\n{s['id']}  lat {s['lat']}  rows {len(t)}  {t[0]} .. {t[-1]}")
    print(f"  1. Sun max altitude {a['sun_alt'].max():.2f} deg, geometric ceiling {ceiling:.2f} deg: "
          f"{'OK' if a['sun_alt'].max() <= ceiling + 0.05 else 'FAIL'}")
    jumps = {}
    for k in a:
        d = np.abs(np.diff(a[k]))
        if k.endswith("_az"):
            d = np.minimum(d, 360 - d)
        jumps[k] = d.max()
    print("  2. Largest change between 10-minute rows (deg): " + ", ".join(f"{k} {v:.2f}" for k, v in jumps.items()))
    prof = json.loads((DATA / s["horizon_file"]).read_text())
    hz = np.array([horizon_at(az, prof["azimuth_deg"], prof["horizon_deg"]) for az in a["sun_az"]])
    flat_up = a["sun_alt"] + 0.27 > 0
    hidden = flat_up & ~(a["sun_alt"] + 0.27 > hz)
    n = int(hidden.sum())
    print(f"  3. Sun above a flat horizon in {int(flat_up.sum())} rows, hidden by terrain in {n} of them ({n / max(1, flat_up.sum()):.0%})")
    if n:
        clear = hidden & (a["sun_alt"] > 0)  # prefer an example where the Sun is really above the flat horizon
        i = int(np.argmax(clear if clear.any() else hidden))
        print(f"     example {t[i]}: Sun alt {a['sun_alt'][i]:.2f} deg at az {a['sun_az'][i]:.1f}, terrain horizon there {hz[i]:.2f} deg")
