"""Horizon profile from a LOLA DEM: azimuth (deg from north, clockwise) -> terrain elevation angle (deg).

Idea: stand at (lat, lon), cast a ray in every azimuth, and for each ray take the maximum
angle at which terrain is seen above the local horizontal. The result does not depend on time,
so it is computed once per site and reused by Combine.

Conventions
- Azimuth: 0 = north, 90 = east, clockwise (same as JPL Horizons).
- The DEM is a south polar stereographic GeoTIFF (x, y in meters), heights in meters
  above a 1737.4 km sphere.
- Ray directions are built from the *real* local north/east (images of d(lat) and d(lon) in
  the map plane), so the code does not assume which way the map axes point.
"""
from dataclasses import dataclass

import numpy as np
import rasterio
from pyproj import CRS, Transformer

MOON_RADIUS_M = 1_737_400.0
MOON_GEOGRAPHIC = CRS.from_proj4(f"+proj=longlat +R={MOON_RADIUS_M} +no_defs")


@dataclass
class Dem:
    z: np.ndarray  # heights in meters, row 0 is the top (max y)
    left: float  # x of the left edge, m
    top: float  # y of the top edge, m
    res: float  # pixel size, m
    crs: CRS


def load_dem(path):
    with rasterio.open(path) as src:
        z = src.read(1).astype("float64")
        if src.nodata is not None and not np.isnan(src.nodata):
            z[z == src.nodata] = np.nan
        return Dem(z=z, left=src.bounds.left, top=src.bounds.top, res=src.res[0], crs=src.crs)


def sample(dem, x, y):
    """Bilinear height at map coordinates (x, y); NaN outside the tile."""
    fj = (x - dem.left) / dem.res - 0.5  # pixel centers sit at +0.5
    fi = (dem.top - y) / dem.res - 0.5
    h, w = dem.z.shape
    inside = (fi >= 0) & (fi <= h - 1) & (fj >= 0) & (fj <= w - 1)
    fi = np.clip(fi, 0, h - 1)
    fj = np.clip(fj, 0, w - 1)
    i0 = np.minimum(np.floor(fi).astype(int), h - 2)
    j0 = np.minimum(np.floor(fj).astype(int), w - 2)
    di, dj = fi - i0, fj - j0
    z = dem.z
    v = (
        z[i0, j0] * (1 - di) * (1 - dj)
        + z[i0, j0 + 1] * (1 - di) * dj
        + z[i0 + 1, j0] * di * (1 - dj)
        + z[i0 + 1, j0 + 1] * di * dj
    )
    return np.where(inside, v, np.nan)


def local_axes(dem_crs, lat, lon, eps=1e-3):
    """Map-plane position of the point and unit vectors of local north and east."""
    t = Transformer.from_crs(MOON_GEOGRAPHIC, dem_crs, always_xy=True)
    x0, y0 = t.transform(lon, lat)
    xn, yn = t.transform(lon, lat + eps)
    xe, ye = t.transform(lon + eps, lat)
    north = np.array([xn - x0, yn - y0])
    east = np.array([xe - x0, ye - y0])
    return (x0, y0), north / np.linalg.norm(north), east / np.linalg.norm(east)


def horizon_profile(dem, lat, lon, observer_height_m=0.0, max_dist_m=8000.0, az_step_deg=1.0, min_dist_m=0.0):
    """Terrain elevation angle for each azimuth, seen from (lat, lon).

    min_dist_m ignores terrain closer than this. At 5 m/pixel (and ~90% interpolated pixels)
    the first few pixels only describe the local slope under the observer, not the real horizon.

    Elevation angle of a terrain point at ground distance d and height h:
        atan2(h - h_obs - d^2 / (2 R), d)
    where the d^2/(2R) term is the drop of the lunar surface due to curvature.
    Rays stop at the tile edge (NaN samples are ignored).
    """
    (x0, y0), north, east = local_axes(dem.crs, lat, lon)
    h_obs = sample(dem, np.array([x0]), np.array([y0]))[0]
    if np.isnan(h_obs):
        raise ValueError("The observer point is outside the DEM tile")
    h_obs += observer_height_m

    az = np.arange(0.0, 360.0, az_step_deg)
    d = np.arange(max(dem.res, min_dist_m), max_dist_m + dem.res, dem.res)
    a = np.radians(az)[:, None]
    direction_x = np.cos(a) * north[0] + np.sin(a) * east[0]
    direction_y = np.cos(a) * north[1] + np.sin(a) * east[1]
    h = sample(dem, x0 + d[None, :] * direction_x, y0 + d[None, :] * direction_y)

    angle = np.degrees(np.arctan2(h - h_obs - d[None, :] ** 2 / (2 * MOON_RADIUS_M), d[None, :]))
    angle = np.where(np.isnan(angle), -np.inf, angle)
    best = angle.argmax(axis=1)
    horizon = angle[np.arange(len(az)), best]
    horizon = np.where(np.isfinite(horizon), horizon, np.nan)
    return {
        "lat": lat,
        "lon": lon,
        "observer_elevation_m": float(h_obs),
        "max_dist_m": float(max_dist_m),
        "azimuth_deg": az.tolist(),
        "horizon_deg": horizon.tolist(),
        "blocking_distance_m": d[best].tolist(),  # where along the ray the max angle occurs
    }


def horizon_at(azimuth, profile_az, profile_horizon):
    """Terrain angle at any azimuth (linear interpolation, wraps around 360)."""
    az = np.asarray(profile_az, dtype=float)
    hz = np.asarray(profile_horizon, dtype=float)
    return np.interp(np.mod(azimuth, 360.0), np.append(az, 360.0), np.append(hz, hz[0]))
