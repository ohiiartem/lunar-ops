"""Export the verified API response as an offline fallback for the Vite viewer."""

import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--api', default='http://127.0.0.1:8000')
parser.add_argument('--output', type=Path, default=Path('public/data'))
args = parser.parse_args()
for site in ('R01', 'R11'):
    scenario = {
        'site_id': 'Site' + site[1:], 'start': '2026-11-07T00:00:00Z',
        'days': 30, 'step_min': 30, 'use_terrain': True,
    }
    request = Request(args.api.rstrip('/') + '/api/timeseries',
                      data=json.dumps(scenario).encode(),
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=10) as response:
        payload = json.load(response)
    if payload.get('data_source') != 'jpl_horizons' or payload.get('site_id') != scenario['site_id']:
        raise ValueError(f'Unexpected source or site: {site}')
    destination = args.output / site / 'sky.json'
    destination.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    print(f'{destination}: {len(payload["t"])} observations')
