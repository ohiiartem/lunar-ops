# Lunar OPS

Prototype for NASA Space Apps 2026, challenge "Lunar Landing Site Navigator".
Compares "site + date" scenarios at the lunar south pole (potential sunlight, geometric Earth visibility).
Not a real mission planning tool.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install rasterio numpy matplotlib pyproj
```

## Data (not stored in git)

Terrain: LOLA 5 m/pixel DEM for south pole sites, from the
[PGDA LOLA_5mpp archive](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/).
Download into `backend/data/`:

```bash
curl -O --output-dir backend/data https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif
```

Site01 (about 41 MB, 16 x 16 km) is centered at lat -89.4632, lon -137.49, which matches site R01
of the Lunar Surface Data Book (M2M-30044, table A2.1-1).
About 90% of pixels in these polar DEMs are interpolated.

Citations: Barker et al. 2021, Planetary and Space Science 203, 105119,
doi:10.1016/j.pss.2020.105119; site numbering from Mazarico et al. 2011, Icarus 211, 1066-1081.

## Scripts

```bash
.venv/bin/python scripts/inspect_dem.py   # prints DEM metadata, writes docs/site01_relief.png
```
