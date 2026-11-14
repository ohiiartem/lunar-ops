"""Compare JPL Horizons angles with the local LOLA horizon at R01 and R11."""
import argparse
import csv
from datetime import datetime, timedelta
from math import isclose, isfinite
from pathlib import Path
import re

SITES = {'R01': (222.51, -89.4632), 'R11': (292.0679, -88.6834)}
TARGETS = {'Sun': '10', 'Earth': '399'}
MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()

def read_ephemeris(path, site):
    header, section = path.read_text(encoding='ascii').split('$$SOE', 1)
    body, _ = section.split('$$EOE', 1)
    target, number = re.search(r'Target body name:\s+(Sun|Earth) \((\d+)\)', header).groups()
    if TARGETS[target] != number or not all(token in header for token in (
        'Moon (301)', 'Date__(UT)', 'Azi_(a-app)', 'Elev_(a-app)'
    )):
        raise ValueError(f'Unexpected Horizons observer table: {path.name}')
    coords = re.search(r'Center geodetic\s*:\s*([^\{]+)', header)[1]
    lon, lat, _ = map(float, coords.split(','))
    expected_lon, expected_lat = SITES[site]
    if not (isclose(lon % 360, expected_lon, abs_tol=1e-6) and
            isclose(lat, expected_lat, abs_tol=1e-6)):
        raise ValueError(f'The lunar coordinates do not match {site}: {path.name}')
    observations = {}
    for row in csv.reader(body.strip().splitlines()):
        date, hm = row[0].strip().split()
        year, month, day = date.split('-')
        hour, minute = map(int, hm.split(':'))
        time = datetime(int(year), MONTHS.index(month)+1, int(day), hour, minute)
        az, el = map(float, row[3:5])
        if not (0 <= az <= 360 and -90 <= el <= 90) or time in observations:
            raise ValueError(f'Invalid or duplicate observation: {row}')
        observations[time] = (az, el)
    times = sorted(observations)
    if not times or any(b-a != timedelta(hours=1) for a,b in zip(times,times[1:])):
        raise ValueError(f'Expected a continuous hourly series: {path.name}')
    return target, observations

def read_profile(path):
    with path.open() as file:
        rows = list(csv.DictReader(file))
    profile = {}
    for row in rows:
        az = int(row['az_deg'])
        angle = row['horizon_deg']
        coverage = float(row['coverage_m'])
        profile[az] = (float(angle), coverage) if angle else (None, coverage)
    if len(rows) != 360 or set(profile) != set(range(360)) or any(
        (angle is not None and not isfinite(angle)) or not isfinite(coverage) or coverage < 0
        for angle, coverage in profile.values()
    ):
        raise ValueError(f'Expected a valid 0–359° profile: {path}')
    return profile

def local_horizon(profile, az):
    az %= 360
    index = int(az)
    a, ca = profile[index]
    if az == index:
        return a, ca
    b, cb = profile[(index+1)%360]
    if a is None or b is None:
        return None, min(ca, cb)
    return a+(b-a)*(az-index), min(ca, cb)

def compare(site, data, inputs):
    objects = {}
    for path in sorted(inputs.glob(f'*{site}.txt')):
        target, observations = read_ephemeris(path, site)
        if target in objects:
            raise ValueError(f'Multiple {target} TXT files for {site}')
        objects[target] = observations
    if set(objects) != set(TARGETS) or objects['Sun'].keys() != objects['Earth'].keys():
        raise ValueError(f'Expected Sun and Earth TXT with the same timestamps for {site}')
    profile = read_profile(data/site/'horizon.csv')
    outfile = data/site/'visibility.csv'
    changed = {target: 0 for target in TARGETS}
    blocked = {target: 0 for target in TARGETS}
    with outfile.open('w', newline='', encoding='utf-8') as file:
        writer = csv.writer(file)
        writer.writerow(['time_ut','target','az_deg','elevation_deg','terrain_horizon_deg',
                         'terrain_margin_deg','above_0deg','above_local_horizon',
                         'terrain_changes_result','coverage_m'])
        for time in sorted(objects['Sun']):
            for target, observations in objects.items():
                az, el = observations[time]
                angle, coverage = local_horizon(profile, az)
                flat = el > 0
                margin = None if angle is None else el-angle
                local = None if margin is None else margin > 0
                differs = None if local is None else flat != local
                changed[target] += differs is True
                blocked[target] += flat and local is False
                writer.writerow([time.isoformat(sep=' ',timespec='minutes'),target,az,el,
                                 None if angle is None else round(angle,6),
                                 None if margin is None else round(margin,6),
                                 int(flat),None if local is None else int(local),
                                 None if differs is None else int(differs),coverage])
    print(f'{site}: {len(objects["Sun"])} отсчётов на объект → {outfile}')
    for target in TARGETS:
        print(f'  {target}: результат изменился в {changed[target]} отсчётах, '
              f'рельеф закрыл центр при EL > 0° в {blocked[target]}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--horizons', type=Path, required=True)
    parser.add_argument('--data', type=Path, default=Path(__file__).resolve().parent/'data')
    args = parser.parse_args()
    for site in SITES:
        compare(site,args.data,args.horizons)
