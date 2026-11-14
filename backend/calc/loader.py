"""Loader for the Horizons observer-table CSV exports the team produces.

Expected row layout (12 values, comma separated), as in telemetry_output*.csv:
  time, flag, RA_h, DEC_deg, azimuth_deg, elevation_deg, range_AU,
  range_rate_km_s, range_km, east_km, north_km, up_km
The exports have a 13-name header (one extra name) over 12-value rows, so the
header is ignored and columns are taken by position. Rows are checked: azimuth
and elevation must agree with the east/north/up vector, otherwise the columns
are shifted and we refuse to use the file.
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List

import numpy as np

N_COLS = 12


@dataclass
class Track:
    label: str
    times: np.ndarray        # datetime64[s], UT, strictly increasing, uniform step
    flags: List[str]         # Horizons presence flags (informational only)
    az_deg: np.ndarray       # clockwise from local north
    el_deg: np.ndarray       # elevation of the body CENTRE, no refraction
    range_km: np.ndarray
    east_km: np.ndarray
    north_km: np.ndarray
    up_km: np.ndarray

    @property
    def step_s(self) -> int:
        return int((self.times[1] - self.times[0]) / np.timedelta64(1, "s"))

    def __len__(self):
        return len(self.times)


def _parse_time(text: str) -> np.datetime64:
    dt = datetime.strptime(text.strip(), "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
    return np.datetime64(dt.replace(tzinfo=None), "s")


def check_consistency(track: Track) -> float:
    """Max difference (deg) between reported az/el and the east/north/up vector."""
    el = np.degrees(np.arcsin(track.up_km / track.range_km))
    az = np.degrees(np.arctan2(track.east_km, track.north_km)) % 360.0
    d_az = (az - track.az_deg + 180.0) % 360.0 - 180.0
    return float(max(np.abs(el - track.el_deg).max(), np.abs(d_az).max()))


def load_track(path: str, label: str = "", tol_deg: float = 0.01) -> Track:
    with open(path, newline="") as f:
        rows = list(csv.reader(f))[1:]
    rows = [r for r in rows if r and any(c.strip() for c in r)]
    if not rows:
        raise ValueError(f"{path}: no data rows")
    bad = [i for i, r in enumerate(rows) if len(r) != N_COLS]
    if bad:
        raise ValueError(f"{path}: row {bad[0] + 2} has {len(rows[bad[0]])} values, expected {N_COLS}")
    times = np.array([_parse_time(r[0]) for r in rows], dtype="datetime64[s]")
    steps = np.diff(times).astype("timedelta64[s]").astype(int)
    if len(times) < 2 or (steps <= 0).any() or (steps != steps[0]).any():
        raise ValueError(f"{path}: times must be strictly increasing with a uniform step")
    col = lambda i: np.array([float(r[i]) for r in rows])
    track = Track(label or path, times, [r[1].strip() for r in rows], col(4), col(5),
                  col(8), col(9), col(10), col(11))
    err = check_consistency(track)
    if err > tol_deg:
        raise ValueError(f"{path}: az/el disagree with east/north/up by {err:.3f} deg (shifted columns?)")
    return track
