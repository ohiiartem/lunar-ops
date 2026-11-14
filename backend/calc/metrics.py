"""Metrics: hours of light, visibility windows, time to sunset / Earth set.

Input: the dict returned by combine.combine() (parallel lists: t, sun_visible, earth_visible,
both_visible, terrain_used). Output: the body of POST /api/analyze.

Convention: sample i describes the interval [t[i], t[i+1]). The last sample gets the same length
as the previous step. A window starts at the first True sample and ends at the first False sample
after it (or at the end of the period), so edges are accurate to one time step only.
"""
import numpy as np


def _parse_times(t):
    """ISO 8601 UTC strings ('...Z') -> numpy datetime64[s]."""
    return np.array([s.rstrip("Z") for s in t], dtype="datetime64[s]")


def _step_hours(times):
    """Length of each sample in hours."""
    if len(times) < 2:
        return np.zeros(len(times))
    dt = np.diff(times).astype("timedelta64[s]").astype(float) / 3600.0
    return np.append(dt, dt[-1])


def _runs(flag):
    """Index ranges [start, end) of consecutive True values."""
    f = np.concatenate(([False], np.asarray(flag, dtype=bool), [False]))
    change = np.flatnonzero(f[1:] != f[:-1])
    return list(zip(change[::2], change[1::2]))


def _iso(x):
    return str(x) + "Z"


def windows(flag, times):
    """List of {'from', 'to'} (ISO UTC) for each run of True."""
    out = []
    n = len(times)
    step_last = _step_hours(times)[-1] if n else 0.0
    for start, end in _runs(flag):
        stop = times[end] if end < n else times[-1] + np.timedelta64(int(round(step_last * 3600)), "s")
        out.append({"from": _iso(times[start]), "to": _iso(stop)})
    return out


def hours_true(flag, times):
    return float(_step_hours(times)[np.asarray(flag, dtype=bool)].sum())


def next_change(flag, times, start=0):
    """Hours from times[start] until the flag at `start` changes; None if it never does.

    Returns (hours_or_None, current_state).
    """
    flag = np.asarray(flag, dtype=bool)
    state = bool(flag[start])
    rest = np.flatnonzero(flag[start:] != state)
    if len(rest) == 0:
        return None, state
    j = start + rest[0]
    return float((times[j] - times[start]) / np.timedelta64(1, "s") / 3600.0), state


def _event(flag, times, start):
    """Time to set (if currently up) or to rise (if currently down) plus a status string."""
    hours, up = next_change(flag, times, start)
    if up:
        return (hours, None, "up_until_set") if hours is not None else (None, None, "up_all_period")
    return (None, hours, "down_until_rise") if hours is not None else (None, None, "down_all_period")


def analyze(series, start_index=0):
    """Summary metrics for one scenario from a combine() result."""
    times = _parse_times(series["t"])
    sun, earth, both = series["sun_visible"], series["earth_visible"], series["both_visible"]
    sun_set, sun_rise, sun_status = _event(sun, times, start_index)
    earth_set, earth_rise, earth_status = _event(earth, times, start_index)
    dark_runs = _runs(~np.asarray(sun, dtype=bool))
    step = _step_hours(times)
    longest_dark = max((float(step[a:b].sum()) for a, b in dark_runs), default=0.0)
    return {
        "terrain_used": series.get("terrain_used", False),
        "period_hours": float(step.sum()),
        "light_hours": hours_true(sun, times),
        "earth_visible_hours": hours_true(earth, times),
        "both_hours": hours_true(both, times),
        "longest_darkness_hours": longest_dark,
        "light_windows": windows(sun, times),
        "earth_windows": windows(earth, times),
        "both_windows": windows(both, times),
        "sun_status": sun_status,  # up_until_set | up_all_period | down_until_rise | down_all_period
        "time_to_sunset_h": sun_set,
        "time_to_sunrise_h": sun_rise,
        "earth_status": earth_status,
        "time_to_earth_set_h": earth_set,
        "time_to_earth_rise_h": earth_rise,
    }
