# Lunar OPS — Lunar Landing Site Navigator (core)

NASA Space Apps Challenge 2026, Poznań. Challenge: *Lunar Landing Site Navigator*.

Geometric visibility of the Sun and the Earth from candidate south-pole landing
sites, with and without real terrain (LOLA 5 m/pixel DEM). Times are **UT**.
Geometry only: no radio-link quality, no solar-panel power.

## What is here
| Path | Content |
|---|---|
| `backend/calc/dem.py` | GeoTIFF loader, polar-stereographic projection, bilinear sampling |
| `backend/calc/horizon.py` | terrain horizon profile (360 azimuths) from the DEM |
| `backend/calc/loader.py` | JPL Horizons CSV loader with consistency checks |
| `backend/calc/combine.py` | Sun/Earth visibility over a flat or terrain horizon |
| `backend/calc/metrics.py` | windows, hours, next change |
| `backend/calc/pipeline.py` | end to end run, writes `data/results/` |
| `data/horizons/` | Horizons tables (10 min step, 14.11.2026 UT) for sites R01, R11, R23 |
| `data/profiles/` | precomputed horizon profiles |
| `data/results/` | pipeline output (JSON + per-step CSV) |
| `docs/` | method (`horizon_report.md`) and decisions/limits (`decisions.md`) |

## Run
Python 3 with `numpy` and `Pillow`; tests use only `unittest`.

```bash
python3 -m unittest discover -s tests
cd backend && python3 -m calc.pipeline --horizons ../data/horizons --profiles ../data/profiles --out ../data/results
```

## Rebuild horizon profiles (needs the LOLA tiles)
Tiles `SiteXX_final_adj_5mpp_surf.tif` are not in git. Get them from the PGDA
high-resolution site topography product (products/78) at
https://pgda.gsfc.nasa.gov, put them in one folder, then:

```bash
cd backend && python3 -m calc.build_profiles --tiles /path/to/tiles --out ../data/profiles
```
Tests that need real tiles read `~/Downloads` and skip if absent.

## Limits (details in `docs/decisions.md`)
- Terrain horizon uses only the tile (16-21 km), so it can only be too low.
- Current Horizons data covers one day; multi-day windows need more tables.
- "Flat horizon" means 0° local horizontal, not the sphere limb.
- Earth is judged by disc centre by default; upper-limb option exists.

## Sources
JPL Horizons (ephemerides), NASA PGDA / LOLA (topography),
NASA Lunar Surface Data Book M2M-30044 (site coordinates).
