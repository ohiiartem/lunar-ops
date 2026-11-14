"""Checks for backend/calc/horizon.py on synthetic terrain.

Run: .venv/bin/python tests/test_horizon.py   (also works with pytest)

The mound is placed using real latitude/longitude offsets (east = larger lon, north = larger lat),
independently of the code that builds ray directions, so these tests catch azimuth mistakes.
"""
import sys
from pathlib import Path

import numpy as np
from pyproj import CRS, Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.calc.horizon import MOON_GEOGRAPHIC, MOON_RADIUS_M, Dem, horizon_at, horizon_profile

LAT, LON = -89.4632, -137.49
STERE = CRS.from_proj4(f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +R={MOON_RADIUS_M} +units=m +no_defs")
TO_XY = Transformer.from_crs(MOON_GEOGRAPHIC, STERE, always_xy=True)


def make_dem(mound_lat=None, mound_lon=None, mound_height=100.0, mound_radius=50.0):
    x0, y0 = TO_XY.transform(LON, LAT)
    n, res = 400, 5.0  # 2 km x 2 km tile centered on the observer
    dem = Dem(z=np.zeros((n, n)), left=x0 - n * res / 2, top=y0 + n * res / 2, res=res, crs=STERE)
    if mound_lat is not None:
        mx, my = TO_XY.transform(mound_lon, mound_lat)
        xs = dem.left + (np.arange(n) + 0.5) * res
        ys = dem.top - (np.arange(n) + 0.5) * res
        xx, yy = np.meshgrid(xs, ys)
        dem.z[(xx - mx) ** 2 + (yy - my) ** 2 <= mound_radius**2] = mound_height
    return dem


def angdiff(a, b):
    return abs((a - b + 180) % 360 - 180)


def test_flat_terrain_is_about_zero():
    p = horizon_profile(make_dem(), LAT, LON, max_dist_m=900)
    h = np.array(p["horizon_deg"])
    assert h.max() <= 0.0 and h.min() > -0.001  # only the curvature drop remains


def test_mound_direction_matches_compass():
    # ~1 km offsets: 1 km of latitude = 0.0330 deg, 1 km along the parallel here = 3.52 deg of lon
    dlat, dlon = 0.0330, 3.52
    cases = {
        0.0: (LAT + dlat, LON),  # north
        90.0: (LAT, LON + dlon),  # east
        180.0: (LAT - dlat, LON),  # south
        270.0: (LAT, LON - dlon),  # west
    }
    for expected_az, (mlat, mlon) in cases.items():
        p = horizon_profile(make_dem(mlat, mlon), LAT, LON, max_dist_m=1500)
        h = np.array(p["horizon_deg"])
        az = np.array(p["azimuth_deg"])
        peak_az = az[h.argmax()]
        assert angdiff(peak_az, expected_az) <= 4, (expected_az, peak_az)
        assert h.max() > 4.0, h.max()  # 100 m mound at ~1 km is about 5.7 deg
        opposite = horizon_at(expected_az + 180, az, h)
        assert opposite < 0.01, opposite


def test_horizon_at_wraps_around():
    az = [0.0, 90.0, 180.0, 270.0]
    hz = [0.0, 1.0, 2.0, 3.0]
    assert abs(horizon_at(315.0, az, hz) - 1.5) < 1e-9  # halfway between 270 (3.0) and 360=0 (0.0)
    assert abs(horizon_at(-45.0, az, hz) - 1.5) < 1e-9


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
