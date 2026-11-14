"""Package JPL Horizons VECTORS CSV exports for the Sun–Earth–Moon viewer.

Use geometric XYZ (VEC_TABLE=1, VEC_CORR=NONE), KM-S, Ecliptic J2000, UTC.
Use 399 from 500@10 with a one-day step and 301 from 500@399 with a three-hour step.
"""

from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path
import csv
import json
import math


def extract(path, target, center):
    header, content = path.read_text().split('$$SOE', 1)
    if not all(field in header for field in (
        f'Target body name: {target}', f'Center body name: {center}',
        'Ecliptic of J2000.0', 'KM-S', 'GEOMETRIC cartesian', 'Calendar Date (UT',
    )):
        raise ValueError(f'Wrong vector table headers: {path}')

    dates = []
    xyz = []
    for row in csv.reader(content.split('$$EOE', 1)[0].strip().splitlines()):
        stamp = row[1].strip().removeprefix('A.D. ')
        dates.append(datetime.strptime(stamp, '%Y-%b-%d %H:%M:%S.%f').replace(tzinfo=timezone.utc))
        xyz.append([round(float(component), 2) for component in row[2:5]])

    steps = {int((end - start).total_seconds() * 1000) for start, end in zip(dates, dates[1:])}
    if len(steps) != 1 or min(steps) <= 0 or not all(math.isfinite(value) for point in xyz for value in point):
        raise ValueError(f'Invalid vector samples: {path}')
    return {'start': dates[0].isoformat(), 'stepMs': steps.pop(), 'xyz': xyz}


if __name__ == '__main__':
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('earth', type=Path)
    parser.add_argument('moon', type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/data/system-orbits.json'))
    args = parser.parse_args()
    data = {
        'source': 'JPL Horizons',
        'frame': 'Ecliptic of J2000.0',
        'units': 'km',
        'earth': extract(args.earth, 'Earth (399)', 'Sun (10)'),
        'moon': extract(args.moon, 'Moon (301)', 'Earth (399)'),
    }
    args.output.write_text(json.dumps(data, separators=(',', ':')) + '\n', encoding='utf-8')
