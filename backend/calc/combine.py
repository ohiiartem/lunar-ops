"""Combine: is a body above the terrain at each moment?

Inputs
- ephemeris arrays (from the JPL Horizons table): t, sun_az, sun_alt, earth_az, earth_alt
  (azimuth in degrees from north, clockwise; altitude in degrees above the local horizontal)
- horizon profile (from horizon.py / LOLA): {"azimuth_deg": [...], "horizon_deg": [...]}
  or None, which means a flat horizon (0 deg everywhere, the "smooth sphere" case)

Output: dict of parallel lists, the body of POST /api/timeseries.
"""
import numpy as np

from .horizon import horizon_at

SUN_LIMB_DEG = 0.27  # the Sun counts as visible while its upper edge is above the terrain


def _terrain(az, profile):
    az = np.asarray(az, dtype=float)
    if profile is None:
        return np.zeros_like(az)
    return horizon_at(az, profile["azimuth_deg"], profile["horizon_deg"])


def combine(t, sun_az, sun_alt, earth_az, earth_alt, profile=None, sun_limb_deg=SUN_LIMB_DEG, ndigits=2):
    sun_alt = np.asarray(sun_alt, dtype=float)
    earth_alt = np.asarray(earth_alt, dtype=float)
    sun_hz = _terrain(sun_az, profile)
    earth_hz = _terrain(earth_az, profile)
    sun_visible = sun_alt + sun_limb_deg > sun_hz
    earth_visible = earth_alt > earth_hz
    r = lambda a: np.round(np.asarray(a, dtype=float), ndigits).tolist()  # noqa: E731
    return {
        "t": list(t),
        "sun_alt": r(sun_alt),
        "sun_az": r(sun_az),
        "sun_horizon": r(sun_hz),
        "sun_visible": sun_visible.tolist(),
        "earth_alt": r(earth_alt),
        "earth_az": r(earth_az),
        "earth_horizon": r(earth_hz),
        "earth_visible": earth_visible.tolist(),
        "both_visible": (sun_visible & earth_visible).tolist(),
        "terrain_used": profile is not None,
    }
