"""Import the hourly CSV sample without inventing missing observations."""
import argparse
import csv
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('csv_path', type=Path)
args = parser.parse_args()
with args.csv_path.open(encoding='utf-8-sig', newline='') as source:
    rows = list(csv.reader(source))
required = {'station_id', 'station_name', 'grass_date', 'hour',
            'lm_hub_received_in_system_order_qty_1h'}
if not rows or not required.issubset(rows[0]):
    raise ValueError('Missing required Throughput Hourly D0 columns')
target = Path(__file__).with_name('hourly.private.json')
target.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
print(f'Imported {len(rows)-1} source rows; blank values preserved: {target}')
