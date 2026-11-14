"""Combine: for every time step, is the Sun / Earth above the horizon?

The horizon is either a flat sphere (angle 0) or the terrain profile of the site.
Sun: upper limb (centre elevation + angular radius), as Horizons does for its '*' flag.
Earth: centre by default; earth_limb=True uses the upper limb (the Earth is ~1.8 deg wide,
so this matters when it sits near the horizon). Geometry only: no signal quality.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .loader import Track

SUN_RADIUS_KM = 695_700.0      # IAU nominal solar radius
EARTH_RADIUS_KM = 6_371.0      # mean radius


def angular_radius_deg(radius_km: float, range_km: np.ndarray) -> np.ndarray:
    return np.degrees(np.arcsin(radius_km / range_km))


def terrain_angle(profile, az_deg: np.ndarray) -> np.ndarray:
    """Terrain elevation angle at the given azimuths (periodic linear interpolation).
    profile: anything with .azimuth_deg and .angle_deg; None means a flat sphere."""
    az = np.asarray(az_deg, dtype=float)
    if profile is None:
        return np.zeros_like(az)
    return np.interp(az % 360.0, np.asarray(profile.azimuth_deg), np.asarray(profile.angle_deg), period=360.0)


@dataclass
class Visibility:
    times: np.ndarray
    sun_up: np.ndarray
    earth_up: np.ndarray
    both: np.ndarray
    horizon_sun_deg: np.ndarray
    horizon_earth_deg: np.ndarray
    terrain: bool
    earth_limb: bool


def visibility(sun: Track, earth: Track, profile=None, earth_limb: bool = False) -> Visibility:
    if len(sun) != len(earth) or not (sun.times == earth.times).all():
        raise ValueError("sun and earth tracks must have identical times")
    h_sun = terrain_angle(profile, sun.az_deg)
    h_earth = terrain_angle(profile, earth.az_deg)
    sun_top = sun.el_deg + angular_radius_deg(SUN_RADIUS_KM, sun.range_km)
    earth_el = earth.el_deg + (angular_radius_deg(EARTH_RADIUS_KM, earth.range_km) if earth_limb else 0.0)
    sun_up = sun_top > h_sun
    earth_up = earth_el > h_earth
    return Visibility(sun.times, sun_up, earth_up, sun_up & earth_up, h_sun, h_earth,
                      profile is not None, earth_limb)
