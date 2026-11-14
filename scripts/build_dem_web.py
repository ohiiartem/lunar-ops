"""Prepare small terrain grids for the 3D map in the web page.

For every site in backend/data/sites.json that has a LOLA tile, writes:
  frontend/dem/<id>.bin   N x N heights, uint16 little-endian, row 0 = north-most map row (top of the tile)
  frontend/dem/<id>.json  {n, size_m, z_min, z_max, north:[x,y], east:[x,y]}
height_m = z_min + value / 65535 * (z_max - z_min). The site is at the tile center.
north / east are unit vectors of local north and east in the map plane (x to the right, y up).

Usage: .venv/bin/python scripts/build_dem_web.py [N=512]
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.calc.horizon import load_dem, local_axes  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 512
OUT = ROOT / "frontend/dem"
OUT.mkdir(parents=True, exist_ok=True)

for site in json.loads((ROOT / "backend/data/sites.json").read_text()):
    tif = ROOT / f"backend/data/{site['id']}_final_adj_5mpp_surf.tif"
    if not tif.exists():
        print(f"{site['id']}: no tile, skipped")
        continue
    dem = load_dem(tif)
    rows, cols = dem.z.shape
    side = min(rows, cols)
    r0, c0 = (rows - side) // 2, (cols - side) // 2
    z = dem.z[r0:r0 + side, c0:c0 + side]
    # block average down to N x N (mean of each block, ignoring gaps)
    edges = np.linspace(0, side, N + 1).astype(int)
    small = np.empty((N, N))
    for i in range(N):
        band = z[edges[i]:edges[i + 1]]
        for j in range(N):
            small[i, j] = np.nanmean(band[:, edges[j]:edges[j + 1]])
    z_min, z_max = float(np.nanmin(small)), float(np.nanmax(small))
    small = np.nan_to_num(small, nan=z_min)
    q = np.round((small - z_min) / (z_max - z_min) * 65535).astype("<u2")
    (OUT / f"{site['id']}.bin").write_bytes(q.tobytes())
    _, north, east = local_axes(dem.crs, site["lat"], site["lon"])
    meta = {"n": N, "size_m": side * dem.res, "z_min": round(z_min, 2), "z_max": round(z_max, 2),
            "north": [round(float(v), 5) for v in north], "east": [round(float(v), 5) for v in east]}
    (OUT / f"{site['id']}.json").write_text(json.dumps(meta))
    print(f"{site['id']}: {cols}x{rows} px -> {N}x{N}, side {meta['size_m']:.0f} m, heights {z_min:.0f}..{z_max:.0f} m")
