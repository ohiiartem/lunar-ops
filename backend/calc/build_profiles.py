"""Build horizon profiles for every site that has a tile.

    python -m calc.build_profiles --tiles ~/Downloads --out ../data/profiles
(run from backend/)
"""
from __future__ import annotations

import argparse
import json
import os

from .dem import load_geotiff
from .horizon import horizon_profile
from .sites import SITES


def build(tiles_dir: str, out_dir: str, radius_m: float, n_az: int, observer_height_m: float):
    os.makedirs(out_dir, exist_ok=True)
    index = {}
    for sid, s in SITES.items():
        path = os.path.join(tiles_dir, s["tile"])
        if not os.path.exists(path):
            index[sid] = {"name": s["name"], "terrain": False, "reason": "tile file not found"}
            continue
        dem = load_geotiff(path)
        p = horizon_profile(dem, s["lat"], s["lon"], radius_m, n_az, observer_height_m)
        data = p.to_dict()
        data.update({"id": sid, "name": s["name"], "source_tile": s["tile"]})
        with open(os.path.join(out_dir, f"{sid}.json"), "w") as f:
            json.dump(data, f)
        index[sid] = {"name": s["name"], "terrain": True, "profile": f"{sid}.json",
                      "coverage_min_m": data["coverage_min_m"], "coverage_max_m": data["coverage_max_m"]}
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, indent=1)
    return index


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--radius", type=float, default=20000.0)
    ap.add_argument("--n-az", type=int, default=360)
    ap.add_argument("--observer-height", type=float, default=0.0)
    a = ap.parse_args()
    for k, v in build(a.tiles, a.out, a.radius, a.n_az, a.observer_height).items():
        print(k, v)
