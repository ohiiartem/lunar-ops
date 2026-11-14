"""Ephemeris source for the API.

Order of preference:
1. A real table backend/data/horizons_<site_id>.csv (JPL Horizons, produced by the Loader) with columns
   t,sun_az,sun_alt,earth_az,earth_alt  (t = ISO 8601 UTC with 'Z', one uniform step).
2. If LUNAR_OPS_DEMO=1: a SYNTHETIC demo series (smooth made-up curves, NOT real positions).
   Responses are marked data_source = "synthetic_demo" so the UI can show a warning banner.
3. Otherwise: DataUnavailable (the API answers 503).
"""
import csv
import math
import os
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DEMO_FROM = datetime(2026, 1, 1)
DEMO_TO = datetime(2028, 12, 31)
_EPOCH = datetime(2026, 12, 1)
_SYNODIC_H = 29.53 * 24
_SIDEREAL_H = 27.32 * 24


class DataUnavailable(Exception):
    pass


class BadGrid(Exception):
    pass


def demo_enabled():
    return os.environ.get("LUNAR_OPS_DEMO") == "1"


def _csv_path(site_id):
    return DATA_DIR / f"horizons_{site_id}.csv"


@lru_cache(maxsize=8)
def _load_csv(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    t = np.array([r["t"].rstrip("Z") for r in rows], dtype="datetime64[s]")
    cols = {k: np.array([float(r[k]) for r in rows]) for k in ("sun_az", "sun_alt", "earth_az", "earth_alt")}
    return t, cols


def data_source(site_id):
    if _csv_path(site_id).exists():
        return "jpl_horizons"
    return "synthetic_demo" if demo_enabled() else "none"


def data_range(site_id):
    """(first, last) datetimes covered, or None if there is no data."""
    src = data_source(site_id)
    if src == "jpl_horizons":
        t, _ = _load_csv(_csv_path(site_id))
        return t[0].astype(datetime), t[-1].astype(datetime)
    if src == "synthetic_demo":
        return DEMO_FROM, DEMO_TO
    return None


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _synthetic(site_id, start, n, step_min):
    phase = (sum(ord(c) for c in site_id) % 360) / 360 * 2 * math.pi
    times = [start + timedelta(minutes=step_min * i) for i in range(n)]
    h = np.array([(t - _EPOCH).total_seconds() / 3600 for t in times])
    sun_az = (np.degrees(2 * math.pi * h / _SYNODIC_H + phase)) % 360
    sun_alt = 1.0 + 1.5 * np.sin(2 * (2 * math.pi * h / _SYNODIC_H + phase))
    earth_az = (60 + 20 * np.sin(2 * math.pi * h / _SIDEREAL_H + phase)) % 360
    earth_alt = 4 * np.sin(2 * math.pi * h / _SIDEREAL_H + phase / 2)
    return [_iso(t) for t in times], sun_az, sun_alt, earth_az, earth_alt


def get_ephemeris(site_id, start, days, step_min):
    """Returns (dict(t, sun_az, sun_alt, earth_az, earth_alt), data_source). `start` is naive UTC."""
    n = int(days * 1440 // step_min)
    src = data_source(site_id)
    if src == "none":
        raise DataUnavailable(f"No ephemeris data for {site_id}")
    if src == "synthetic_demo":
        t, saz, salt, eaz, ealt = _synthetic(site_id, start, n, step_min)
        return {"t": t, "sun_az": saz, "sun_alt": salt, "earth_az": eaz, "earth_alt": ealt}, src

    times, cols = _load_csv(_csv_path(site_id))
    table_step = int((times[1] - times[0]) / np.timedelta64(1, "s"))
    step_s = step_min * 60
    offset_s = (np.datetime64(start, "s") - times[0]) / np.timedelta64(1, "s")
    if step_s % table_step or offset_s % table_step:
        raise BadGrid(f"start/step_min must fit the table grid (table step = {table_step} s)")
    first = int(offset_s // table_step)
    idx = first + np.arange(n) * (step_s // table_step)
    if idx[0] < 0 or idx[-1] >= len(times):
        raise BadGrid("Requested period is outside the table")
    out = {"t": [_iso(x.astype(datetime)) for x in times[idx]]}
    out.update({k: v[idx] for k, v in cols.items()})
    return out, src
