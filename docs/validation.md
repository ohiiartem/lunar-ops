# Validation of the data and the calculation

Status: **partial** (Sun/Earth positions are independently confirmed; terrain and Site06 are not). What is checked is listed with its result; what is not checked is stated explicitly.
Reproduce: `.venv/bin/python scripts/validate_tables.py`, `scripts/cross_check_skyfield.py <kernel_dir>` (needs `pip install -r requirements-validation.txt` and four NAIF kernels, URLs are printed by the script) and the tests in `tests/`.

## 1. What is checked now

### 1.1 Geometry of the JPL Horizons tables (Site01, Site11, Site23)

The Moon's axis is tilted by 1.54 deg, so the Sun at a site at angular distance d from the pole can never be
higher than 1.54 deg + d. The tables respect this and reach it almost exactly:

| Site | Latitude | Max Sun altitude in the table | Ceiling (1.54 + 90 - |lat|) |
|---|---|---|---|
| Site01 | -89.463 | 1.99 deg | 2.08 deg |
| Site11 | -88.683 | 2.79 deg | 2.86 deg |
| Site23 | -85.995 | 5.53 deg | 5.55 deg |

Meaning: the **latitude** used for the Horizons observer matches the latitude in `sites.json`
(a latitude error of about 1 deg would move the maximum by about 1 deg). Longitude is confirmed by the independent
recomputation in 1.2.

No jumps: between neighbouring 10-minute rows the Sun azimuth changes by at most 0.08 deg and altitude by at most
0.01 deg, Earth azimuth/altitude by at most 0.02 deg. A shifted, duplicated or corrupted row would break this.

The server also validates every table when loading (uniform step, no gaps, azimuth 0..360, altitude -90..90),
see `backend/calc/ephemeris.py` and `GET /api/health`.

### 1.2 Independent recomputation with skyfield (positions confirmed)

`scripts/cross_check_skyfield.py` recomputes Sun and Earth azimuth/altitude for the same observer with a different
tool: skyfield 1.55, ephemeris DE440s, Moon orientation DE421 (the frame of the LOLA DEMs), observer on the sphere
R = 1737.4 km at the latitude/longitude from `sites.json`, height 0, light-time and aberration included, no refraction.
Four sample times per site (2026-11-20 00:00, 2026-12-15 12:00, 2027-01-20 06:00, 2027-02-10 18:40 UTC), Sun and Earth:

| Site | Samples | Largest difference, azimuth | Largest difference, altitude |
|---|---|---|---|
| Site01 | 8 | < 0.001 deg | < 0.001 deg |
| Site11 | 8 | < 0.001 deg | < 0.001 deg |
| Site23 | 8 | < 0.001 deg | 0.001 deg |

Meaning: the Horizons tables of Site01, Site11 and Site23 were computed for exactly the latitude **and longitude** listed
in `sites.json` (at these polar sites the azimuth is very sensitive to longitude, so a wrong longitude would show up
immediately), and the table contents are not shifted or mislabelled. Two independent tools agree to better than 0.002 deg.
This is a check of positions only, not of terrain.

### 1.3 Control case: Sun above the flat horizon but hidden by terrain

This is the effect that the project exists to show. Rows of the real tables (14 Nov 2026 - 14 Feb 2027) where
`sun_alt + 0.27 > 0` (visible over a flat horizon) but the LOLA horizon at the Sun's azimuth is higher:

| Site | Rows with Sun over flat horizon | Hidden by terrain | Example |
|---|---|---|---|
| Site01 | 13023 | 3579 (27%) | 2026-11-25 21:30 UTC: Sun 1.25 deg at az 119.5, terrain horizon 1.52 deg |
| Site11 | 11217 | 2453 (22%) | 2026-12-01 17:40 UTC: Sun 2.70 deg at az 339.0, terrain horizon 2.97 deg |
| Site23 | 7858 | 5266 (67%) | 2026-11-15 03:40 UTC: Sun 0.00 deg at az 112.9, terrain horizon 1.50 deg |

Effect on the metrics (30 days from 2026-12-01, step 30 min, `POST /api/analyze`):

| Site | Light hours, flat | Light hours, terrain | Longest darkness, flat | Longest darkness, terrain |
|---|---|---|---|---|
| Site01 | 720.0 | 559.0 | 0.0 h | 147.5 h |
| Site11 | 720.0 | 635.5 | 0.0 h | 51.0 h |
| Site23 | 463.5 | 361.0 | 256.5 h | 164.5 h |

### 1.4 Terrain horizon: two implementations compared

The web page's author wrote a separate horizon-profile code (`visualization/scripts/prepare_lola.py`: rays up to
23 km, nearest pixel, 2 m mast) independently of ours (`backend/calc/horizon.py`: bilinear sampling, rays limited to the
tile, 2 m observer). Both use the same LOLA DEM, so this checks the code, not the DEM. Difference of the horizon angle,
his minus ours, over 360 azimuths:

| Site | Mean | RMS | Largest | Horizon range (his / ours) |
|---|---|---|---|---|
| Site01 | 0.11 deg | 0.14 deg | 0.58 deg | -4.54..2.47 / -4.62..2.21 |
| Site11 | 0.07 deg | 0.12 deg | 0.81 deg | -5.76..3.26 / -5.86..3.16 |
| Site23 | -0.01 deg | 0.05 deg | 0.32 deg | -4.57..5.30 / -4.52..5.26 |
| Site06 | 0.28 deg | 0.48 deg | 1.80 deg | -14.16..13.73 / -14.67..12.90 |

The profiles agree in shape and range; the remaining differences come from sampling (nearest pixel vs bilinear),
ray length and the rounded site coordinates. Site06 has the steepest terrain and the largest difference.

### 1.5 Unit tests (`tests/`)

- `test_horizon.py`: a synthetic mound placed by real lat/lon offsets to the N/E/S/W gives the horizon at the right
  azimuth (guards against a mirrored or rotated compass); flat terrain gives about 0 deg; periodic interpolation.
- `test_combine.py`, `test_metrics.py`: visibility rules and windows on hand-made series.
- `test_api.py`: endpoints, error codes, bad tables, `/api/health`.

## 2. NOT checked yet (do not claim in the presentation)

1. **Observer height in the Horizons request** is assumed to be 0 (the sphere). The cross-check used 0 and agrees to
   0.001 deg, so a large height offset in the tables is very unlikely, but the request itself was not inspected.
2. **Sample size of the cross-check:** 4 times per site (24 values per site). Smoothness (1.1) covers the rest of
   the 13249 rows. Site06 is not covered.
3. **Terrain (DEM itself):** 90% of pixels of the 5 m LOLA polar DEMs are interpolated (Barker et al. 2021); the observer height
   above the ground is an assumption (2 m); rays are limited to the 16 x 16 km tile, so mountains outside it are not
   seen. The horizon was compared only with a second implementation on the same DEM (1.4), not with another data source (for example NASA Moon Trek / LOLA products).
4. **Site06** has no Horizons table yet.
5. **Earth visibility is geometric** (centre of Earth above the terrain horizon). It is not link quality.
6. **Sun visibility** uses the upper limb (0.27 deg), no refraction (the Moon has no atmosphere).
7. Window edges are accurate to one time step (30 min by default; the stored tables have 10 min).
