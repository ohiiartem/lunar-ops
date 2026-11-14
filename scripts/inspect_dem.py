"""Task 3.1: read a LOLA terrain tile, print its metadata and draw a map.

Usage: .venv/bin/python scripts/inspect_dem.py [path_to_tif] [path_to_png]
"""
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from matplotlib.colors import LightSource

tif = sys.argv[1] if len(sys.argv) > 1 else "backend/data/Site01_final_adj_5mpp_surf.tif"
png = sys.argv[2] if len(sys.argv) > 2 else "docs/site01_relief.png"

with rasterio.open(tif) as src:
    z = src.read(1).astype("float64")
    nodata = src.nodata
    print("size (rows x cols):", src.height, "x", src.width)
    print("CRS:", src.crs)
    print("pixel size (m):", src.res)
    print("bounds X/Y (m):", src.bounds)
    print("nodata:", nodata)
    print("dtype:", src.dtypes[0])
    res = src.res[0]
    bounds = src.bounds

if nodata is not None:
    z[z == nodata] = np.nan
print("NaN pixels:", int(np.isnan(z).sum()))
print(f"elevation: min={np.nanmin(z):.1f} m, max={np.nanmax(z):.1f} m, "
      f"range={np.nanmax(z) - np.nanmin(z):.1f} m, mean={np.nanmean(z):.1f} m")
ci, cj = z.shape[0] // 2, z.shape[1] // 2
print(f"elevation at center: {z[ci, cj]:.1f} m")

ls = LightSource(azdeg=315, altdeg=20)
shade = ls.hillshade(np.nan_to_num(z, nan=np.nanmean(z)), vert_exag=1.0, dx=res, dy=res)

extent_km = [
    (bounds.left) / 1000, (bounds.right) / 1000,
    (bounds.bottom) / 1000, (bounds.top) / 1000,
]
fig, ax = plt.subplots(1, 2, figsize=(13, 6))
im = ax[0].imshow(z, cmap="terrain", extent=extent_km)
ax[0].set_title("LOLA Site01: elevation (m)")
ax[0].set_xlabel("X, km (south polar stereographic)")
ax[0].set_ylabel("Y, km")
fig.colorbar(im, ax=ax[0], shrink=0.8, label="elevation, m")
ax[1].imshow(shade, cmap="gray", extent=extent_km)
ax[1].set_title("Same terrain, hillshade (light from NW)")
ax[1].set_xlabel("X, km")
plt.tight_layout()
plt.savefig(png, dpi=110)
print("image saved:", png)
