"""Loading a LOLA DEM tile (GeoTIFF, south polar stereographic) and map projection.

Only the layout used by the PGDA "SiteXX_final_adj_5mpp_surf.tif" tiles is
supported: single band float32, uncompressed, PixelIsArea, metres in the
polar stereographic plane, heights in metres above a sphere of radius R.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from PIL import Image

MOON_RADIUS_M = 1_737_400.0  # same sphere the tiles use (GeoKey 34736)

Image.MAX_IMAGE_PIXELS = None


@dataclass
class Dem:
    heights: np.ndarray  # (rows, cols) float32, metres
    x_ul: float          # projected x of the tile's upper-left CORNER, metres
    y_ul: float          # projected y of the tile's upper-left CORNER, metres
    pixel_m: float       # pixel size, metres

    @property
    def shape(self):
        return self.heights.shape

    def contains(self, x, y):
        col, row = self.xy_to_colrow(x, y)
        return (col >= 0) & (col <= self.shape[1] - 1) & (row >= 0) & (row <= self.shape[0] - 1)

    def xy_to_colrow(self, x, y):
        # PixelIsArea: pixel centres sit half a pixel inside the corner
        col = (np.asarray(x) - self.x_ul) / self.pixel_m - 0.5
        row = (self.y_ul - np.asarray(y)) / self.pixel_m - 0.5
        return col, row

    def sample(self, x, y):
        """Bilinear height at projected (x, y); NaN outside the tile."""
        col, row = self.xy_to_colrow(x, y)
        inside = (col >= 0) & (col <= self.shape[1] - 1) & (row >= 0) & (row <= self.shape[0] - 1)
        c = np.clip(col, 0, self.shape[1] - 1)
        r = np.clip(row, 0, self.shape[0] - 1)
        c0 = np.minimum(np.floor(c).astype(int), self.shape[1] - 2)
        r0 = np.minimum(np.floor(r).astype(int), self.shape[0] - 2)
        fc, fr = c - c0, r - r0
        h = self.heights
        v = (h[r0, c0] * (1 - fc) * (1 - fr) + h[r0, c0 + 1] * fc * (1 - fr)
             + h[r0 + 1, c0] * (1 - fc) * fr + h[r0 + 1, c0 + 1] * fc * fr)
        return np.where(inside, v, np.nan)


def load_geotiff(path: str) -> Dem:
    im = Image.open(path)
    tags = im.tag_v2
    if im.mode != "F":
        raise ValueError(f"expected float32 tile, got mode {im.mode}")
    scale = tags[33550]    # ModelPixelScale
    tie = tags[33922]      # ModelTiepoint (i, j, k, x, y, z)
    if tie[0] != 0 or tie[1] != 0:
        raise ValueError("unexpected tiepoint, tile is not anchored at its corner")
    if abs(scale[0] - scale[1]) > 1e-9:
        raise ValueError("non-square pixels")
    return Dem(np.array(im, dtype=np.float32), float(tie[3]), float(tie[4]), float(scale[0]))


def latlon_to_xy(lat_deg: float, lon_deg: float, radius_m: float = MOON_RADIUS_M):
    """South polar stereographic (LOLA convention): x = rho*sin(lon), y = rho*cos(lon)."""
    colat = math.radians(90.0 + lat_deg)
    rho = 2.0 * radius_m * math.tan(colat / 2.0)
    lon = math.radians(lon_deg)
    return rho * math.sin(lon), rho * math.cos(lon)


def xy_to_latlon(x: float, y: float, radius_m: float = MOON_RADIUS_M):
    rho = math.hypot(x, y)
    colat = 2.0 * math.atan(rho / (2.0 * radius_m))
    return math.degrees(colat) - 90.0, math.degrees(math.atan2(x, y))
