"""Run loader + combine + metrics for a site and write the merged data.

    cd backend && python -m calc.pipeline --horizons ../data/horizons --profiles ../data/profiles --out ../data/results

Inputs per site <ID>: horizons/sun_<ID>.csv, horizons/earth_<ID>.csv, profiles/<ID>.json (optional).
Outputs per site: results/<ID>.json (summary for flat horizon and for terrain) and
results/<ID>_steps.csv (every time step: positions, terrain angle, visibility flags).
"""
from __future__ import annotations

import argparse
import csv
import json
import os

import numpy as np

from .combine import angular_radius_deg, SUN_RADIUS_KM, visibility
from .horizon import load_profile
from .loader import load_track
from .metrics import summary
from .sites import SITES


def run_site(sid: str, horizons_dir: str, profiles_dir: str, earth_limb: bool = False):
    sun = load_track(os.path.join(horizons_dir, f"sun_{sid}.csv"), f"sun {sid}")
    earth = load_track(os.path.join(horizons_dir, f"earth_{sid}.csv"), f"earth {sid}")
    pp = os.path.join(profiles_dir, f"{sid}.json")
    profile = load_profile(pp) if os.path.exists(pp) else None
    flat = visibility(sun, earth, None, earth_limb)
    terr = visibility(sun, earth, profile, earth_limb) if profile is not None else None
    return sun, earth, profile, flat, terr


def export_site(sid, horizons_dir, profiles_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    sun, earth, profile, flat, terr = run_site(sid, horizons_dir, profiles_dir)
    meta = SITES[sid]
    out = {
        "id": sid, "name": meta["name"], "lat": meta["lat"], "lon": meta["lon"],
        "terrain_available": profile is not None,
        "site_height_m": None if profile is None else profile.site_height_m,
        "profile_coverage_m": None if profile is None else [float(profile.coverage_m.min()), float(profile.coverage_m.max())],
        "span_utc": [str(sun.times[0]) + "Z", str(sun.times[-1]) + "Z"],
        "horizontal_plane": summary(flat),
        "horizontal_plane_earth_limb": summary(visibility(sun, earth, None, True)),
        "terrain": None if terr is None else summary(terr),
        "terrain_earth_limb": None if terr is None else summary(visibility(sun, earth, profile, True)),
        "note": "horizontal_plane = horizon at 0 deg elevation (local horizontal), not the sphere limb; "
                "terrain profile is limited to the DEM tile, so it can only be too low.",
    }
    with open(os.path.join(out_dir, f"{sid}.json"), "w") as f:
        json.dump(out, f, indent=1)
    v = terr if terr is not None else flat
    sun_top = sun.el_deg + angular_radius_deg(SUN_RADIUS_KM, sun.range_km)
    with open(os.path.join(out_dir, f"{sid}_steps.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time_utc", "sun_az_deg", "sun_el_center_deg", "sun_el_upper_limb_deg", "earth_az_deg",
                    "earth_el_center_deg", "terrain_at_sun_deg", "terrain_at_earth_deg",
                    "sun_up", "earth_up", "both_up", "sun_up_horizontal_plane", "earth_up_horizontal_plane"])
        for i in range(len(sun)):
            w.writerow([str(sun.times[i]) + "Z", f"{sun.az_deg[i]:.4f}", f"{sun.el_deg[i]:.4f}", f"{sun_top[i]:.4f}",
                        f"{earth.az_deg[i]:.4f}", f"{earth.el_deg[i]:.4f}",
                        f"{v.horizon_sun_deg[i]:.4f}", f"{v.horizon_earth_deg[i]:.4f}",
                        int(v.sun_up[i]), int(v.earth_up[i]), int(v.both[i]),
                        int(flat.sun_up[i]), int(flat.earth_up[i])])
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizons", required=True)
    ap.add_argument("--profiles", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sites", nargs="*", default=list(SITES))
    a = ap.parse_args()
    print(f"{'site':5s} {'mode':16s} {'sun h':>6s} {'earth h':>8s} {'joint h':>8s}")
    for sid in a.sites:
        if not (os.path.exists(os.path.join(a.horizons, f"sun_{sid}.csv")) and os.path.exists(os.path.join(a.horizons, f"earth_{sid}.csv"))):
            print(f"{sid:5s} skipped: no Horizons files")
            continue
        r = export_site(sid, a.horizons, a.profiles, a.out)
        for key, label in (("horizontal_plane", "0 deg horizon"), ("terrain", "terrain")):
            s = r[key]
            if s:
                print(f"{sid:5s} {label:16s} {s['sun_hours']:6.2f} {s['earth_hours']:8.2f} {s['joint_hours']:8.2f}")
