"""Horizon profile of a site from a DEM tile: azimuth -> terrain elevation angle.

Azimuth is measured clockwise from local north (towards the lunar north pole),
the same convention as JPL Horizons. Angles are in degrees.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .dem import MOON_RADIUS_M, Dem, latlon_to_xy, xy_to_latlon


@dataclass
class HorizonProfile:
    azimuth_deg: np.ndarray    # (n_az,)
    angle_deg: np.ndarray      # terrain elevation angle seen at that azimuth
    coverage_m: np.ndarray     # how far the DEM reaches along that azimuth
    site_height_m: float
    lat: float
    lon: float
    radius_m: float            # requested search radius
    observer_height_m: float

    def to_dict(self):
        return {
            "lat": self.lat, "lon": self.lon,
            "site_height_m": round(self.site_height_m, 2),
            "observer_height_m": self.observer_height_m,
            "search_radius_m": self.radius_m,
            "coverage_min_m": round(float(self.coverage_m.min()), 1),
            "coverage_max_m": round(float(self.coverage_m.max()), 1),
            "azimuth_deg": [round(float(a), 3) for a in self.azimuth_deg],
            "angle_deg": [round(float(a), 4) for a in self.angle_deg],
            "coverage_m": [round(float(c), 1) for c in self.coverage_m],
        }


def horizon_profile(dem: Dem, lat: float, lon: float, radius_m: float = 20_000.0,
                    n_az: int = 360, observer_height_m: float = 0.0,
                    min_dist_m: float = 20.0, sphere_radius_m: float = MOON_RADIUS_M) -> HorizonProfile:
    """Horizon seen from (lat, lon) using only terrain inside the DEM tile.

    For each azimuth the ray is walked in steps of one pixel. The angle at
    distance d is atan2(h(d) - h0 - d^2/(2R), d); the horizon is the maximum
    over d. The d^2/(2R) term is the drop of the curved surface.
    Distances are measured in the projected plane (error < 0.1% at these latitudes).
    """
    x0, y0 = latlon_to_xy(lat, lon, sphere_radius_m)
    if not dem.contains(x0, y0):
        raise ValueError("site is outside the DEM tile")
    h0 = float(dem.sample(np.array([x0]), np.array([y0]))[0]) + observer_height_m

    lon_r = math.atan2(x0, y0)
    north = np.array([math.sin(lon_r), math.cos(lon_r)])
    east = np.array([math.cos(lon_r), -math.sin(lon_r)])

    az = np.arange(n_az) * (360.0 / n_az)
    az_r = np.radians(az)
    dirs = np.cos(az_r)[:, None] * north[None, :] + np.sin(az_r)[:, None] * east[None, :]

    d = np.arange(min_dist_m, radius_m + dem.pixel_m, dem.pixel_m)
    d = d[d <= radius_m]
    xs = x0 + dirs[:, 0:1] * d[None, :]
    ys = y0 + dirs[:, 1:2] * d[None, :]
    h = dem.sample(xs, ys)                      # NaN outside the tile
    ang = np.arctan2(h - h0 - d[None, :] ** 2 / (2.0 * sphere_radius_m), d[None, :])
    inside = ~np.isnan(ang)
    best = np.where(inside, ang, -np.inf).max(axis=1)
    last = np.where(inside, d[None, :], 0.0).max(axis=1)
    if np.isinf(best).any():
        raise ValueError("no DEM coverage along some azimuth")
    lat_c, lon_c = xy_to_latlon(x0, y0, sphere_radius_m)
    return HorizonProfile(az, np.degrees(best), last, h0 - observer_height_m,
                          lat_c, lon_c, radius_m, observer_height_m)


def blocked_by_terrain(profile: HorizonProfile, azimuth_deg: float, elevation_deg: float) -> bool:
    """True if a body at (azimuth, elevation) is below the terrain horizon (linear interpolation)."""
    n = len(profile.azimuth_deg)
    step = 360.0 / n
    a = azimuth_deg % 360.0
    i = int(a // step)
    f = (a - i * step) / step
    horizon = profile.angle_deg[i] * (1 - f) + profile.angle_deg[(i + 1) % n] * f
    return elevation_deg < horizon


def load_profile(path: str) -> HorizonProfile:
    """Read a profile written by build_profiles (data/profiles/<id>.json)."""
    import json
    with open(path) as f:
        d = json.load(f)
    return HorizonProfile(np.array(d["azimuth_deg"]), np.array(d["angle_deg"]), np.array(d["coverage_m"]),
                          d["site_height_m"], d["lat"], d["lon"], d["search_radius_m"], d["observer_height_m"])
