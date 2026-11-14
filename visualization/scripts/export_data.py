"""Copy display assets and compact the visibility table for the browser."""
import argparse
import csv
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
args = parser.parse_args()
output = Path(__file__).resolve().parents[1]/'public'/'data'
for site in ('R01','R11'):
    source = args.source/site
    dest = output/site
    dest.mkdir(parents=True,exist_ok=True)
    for name in ('metadata.json','hillshade.webp'):
        shutil.copyfile(source/name, dest/name)
    # Export the original 16-bit height codes without browser PNG color conversion.
    with Image.open(source/'hillshade.webp') as image:
        shade = np.asarray(image.convert('L'), dtype=float)/255
        image.resize((256,256),Image.Resampling.LANCZOS).save(dest/'overview.webp',quality=87)
    with Image.open(source/'heightmap-512.png') as image:
        codes = np.asarray(image, dtype='<u2')
        if codes.shape != (512,512):
            raise ValueError(f'{site}: expected a 512 × 512 heightmap')
        (dest/'terrain-512.bin').write_bytes(codes.tobytes())
    low = np.array([49,65,78])
    high = np.array([219,205,172])
    height = np.maximum(codes.astype(float)-1,0)/65534
    colors = (low+(high-low)*height[...,None])*(.62+.38*shade[...,None])
    Image.fromarray(np.dstack([colors.astype('uint8'),(codes!=0).astype('uint8')*255])).save(
        dest/'elevation.webp',lossless=True)
    shutil.copyfile(source/'horizon.csv',dest/'horizon.csv')
    with Image.open(source/'heightmap-1024.png') as image:
        np.asarray(image,dtype='<u2').tofile(dest/'terrain-1024.bin')
    with (source/'visibility.csv').open() as f:
        rows = list(csv.DictReader(f))
    times = sorted({row['time_ut'] for row in rows})
    data = {'times':times}
    for target in ('Earth','Sun'):
        selected = sorted((r for r in rows if r['target']==target),key=lambda r:r['time_ut'])
        if [r['time_ut'] for r in selected] != times:
            raise ValueError(f'{site} {target}: missing or duplicate sample')
        data[target] = [[float(r['az_deg']),float(r['elevation_deg']),
                         float(r['terrain_horizon_deg']) if r['terrain_horizon_deg'] else None,
                         int(r['above_0deg']),
                         int(r['above_local_horizon']) if r['above_local_horizon'] else None]
                        for r in selected]
    (dest/'visibility.json').write_text(json.dumps(data,separators=(',',':')))
