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


class BadTable(Exception):
    """A horizons_<site>.csv exists but its content is not usable (message says why)."""


COLUMNS = ("sun_az", "sun_alt", "earth_az", "earth_alt")


def validate_table(t, cols):
    """Checks a parsed table (t = datetime64[s] array, cols = dict of float arrays). Raises BadTable."""
    if len(t) < 2:
        raise BadTable("table has fewer than 2 rows")
    for k in COLUMNS:
        bad = ~np.isfinite(cols[k])
        if bad.any():
            raise BadTable(f"column {k}: non-numeric or empty value at row {int(np.argmax(bad)) + 2}")
    d = np.diff(t) / np.timedelta64(1, "s")
    if (d <= 0).any():
        i = int(np.argmax(d <= 0))
        raise BadTable(f"time is not strictly increasing at row {i + 3} ({t[i + 1]} after {t[i]})")
    if (d != d[0]).any():
        i = int(np.argmax(d != d[0]))
        raise BadTable(f"time step is not uniform: {int(d[0])} s at start, {int(d[i])} s at row {i + 3} (gap or mixed step)")
    if d[0] < 60 or d[0] > 86400:
        raise BadTable(f"time step {int(d[0])} s is outside 1 min .. 1 day")
    for k in ("sun_az", "earth_az"):
        v = cols[k]
        if ((v < 0) | (v > 360)).any():
            raise BadTable(f"column {k}: azimuth outside 0..360 at row {int(np.argmax((v < 0) | (v > 360))) + 2}")
    for k in ("sun_alt", "earth_alt"):
        v = cols[k]
        if ((v < -90) | (v > 90)).any():
            raise BadTable(f"column {k}: altitude outside -90..90 at row {int(np.argmax((v < -90) | (v > 90))) + 2}")


def demo_enabled():
    return os.environ.get("LUNAR_OPS_DEMO") == "1"


def _csv_path(site_id):
    return DATA_DIR / f"horizons_{site_id}.csv"


@lru_cache(maxsize=8)
def _load_csv(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in ("t",) + COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise BadTable(f"missing column(s): {', '.join(missing)}; expected header t,sun_az,sun_alt,earth_az,earth_alt")
        rows = list(reader)
    try:
        t = np.array([r["t"].strip().rstrip("Z") for r in rows], dtype="datetime64[s]")
    except ValueError:
        raise BadTable("column t: not ISO 8601 (expected like 2026-12-01T00:00:00Z)")
    cols = {}
    for k in COLUMNS:
        vals = []
        for r in rows:
            try:
                vals.append(float(r[k]))
            except (TypeError, ValueError):
                vals.append(float("nan"))
        cols[k] = np.array(vals)
    validate_table(t, cols)
    return t, cols


def table_info(site_id):
    """Describes the real table of a site without raising: {'present', 'valid', 'error', 'from', 'to', 'step_min', 'rows'}."""
    path = _csv_path(site_id)
    if not path.exists():
        return {"present": False, "valid": False, "error": None, "from": None, "to": None, "step_min": None, "rows": 0}
    try:
        t, _ = _load_csv(path)
    except BadTable as e:
        return {"present": True, "valid": False, "error": str(e), "from": None, "to": None, "step_min": None, "rows": 0}
    return {"present": True, "valid": True, "error": None, "from": _iso(t[0].astype(datetime)),
            "to": _iso(t[-1].astype(datetime)), "step_min": int((t[1] - t[0]) / np.timedelta64(60, "s")), "rows": len(t)}


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
