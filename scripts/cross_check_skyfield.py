"""Independent cross-check of the JPL Horizons tables with skyfield (DE440s ephemeris + Moon orientation DE421, the frame of the LOLA DEMs).

Needs `pip install skyfield` and four NAIF kernels in one folder (the script prints the download URLs if missing):
  de440s.bsp, moon_pa_de421_1900-2050.bpc, moon_080317.tf, pck00011.tpc
Observer: a point on the lunar sphere (R = 1737.4 km), latitude/longitude from backend/data/sites.json, height 0,
Moon-fixed frame MOON_ME. Compares Sun and Earth azimuth/altitude with backend/data/horizons_<id>.csv at a few times.

Usage: .venv/bin/python scripts/cross_check_skyfield.py <kernel_dir>
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np
from skyfield.api import Loader
from skyfield.framelib import ecliptic_frame  # noqa: F401  (import check)
from skyfield.planetarylib import PlanetaryConstants

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
FILES = {"de440s.bsp": "spk/planets/", "moon_pa_de421_1900-2050.bpc": "pck/", "moon_080317.tf": "fk/satellites/", "pck00011.tpc": "pck/"}
SAMPLE_TIMES = ["2026-11-20T00:00:00Z", "2026-12-15T12:00:00Z", "2027-01-20T06:00:00Z", "2027-02-10T18:40:00Z"]

kdir = Path(sys.argv[1]) if len(sys.argv) > 1 else None
if kdir is None or not all((kdir / f).exists() for f in FILES):
    print("Missing kernels. Download into one folder and pass it as the argument:")
    for f, d in FILES.items():
        print(f"  {BASE}{d}{f}")
    sys.exit(1)

load = Loader(str(kdir))
ts = load.timescale()
eph = load("de440s.bsp")
pc = PlanetaryConstants()
pc.read_text(load("moon_080317.tf"))
pc.read_text(load("pck00011.tpc"))
pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
frame = pc.build_frame_named("MOON_ME_DE421")

worst = {"Sun": [0, 0], "Earth": [0, 0]}
for s in json.loads((ROOT / "backend/data/sites.json").read_text()):
    path = ROOT / f"backend/data/horizons_{s['id']}.csv"
    if not path.exists():
        continue
    table = {r["t"]: r for r in csv.DictReader(open(path))}
    observer = eph["moon"] + pc.build_latlon_degrees(frame, s["lat"], s["lon"], elevation_m=0.0)
    print(f"\n{s['id']} (lat {s['lat']}, lon {s['lon']})")
    print(f"  {'time (UTC)':20} {'body':5} {'Horizons az/alt':>20} {'skyfield az/alt':>20} {'d_az':>7} {'d_alt':>7}")
    for t in SAMPLE_TIMES:
        row = table[t]
        when = ts.utc(int(t[:4]), int(t[5:7]), int(t[8:10]), int(t[11:13]), int(t[14:16]))
        for name, key in (("Sun", "sun"), ("Earth", "earth")):
            body = eph["sun"] if name == "Sun" else eph["earth"]
            alt, az, _ = observer.at(when).observe(body).apparent().altaz()
            h_az, h_alt = float(row[f"{key}_az"]), float(row[f"{key}_alt"])
            d_az = (az.degrees - h_az + 180) % 360 - 180
            d_alt = alt.degrees - h_alt
            worst[name] = [max(worst[name][0], abs(d_az)), max(worst[name][1], abs(d_alt))]
            print(f"  {t:20} {name:5} {h_az:9.3f}/{h_alt:8.3f} {az.degrees:9.3f}/{alt.degrees:8.3f} {d_az:7.3f} {d_alt:7.3f}")
print("\nLargest differences (deg): " + ", ".join(f"{k}: az {v[0]:.3f}, alt {v[1]:.3f}" for k, v in worst.items()))
