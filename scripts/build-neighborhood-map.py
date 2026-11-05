#!/usr/bin/env python3
"""Refresh the bundled Mission District map from one public OSM API extract.

Usage: python3 scripts/build-neighborhood-map.py /path/to/osm.xml
Source: https://api.openstreetmap.org/api/0.6/map?bbox=-122.422,37.757,-122.407,37.770
Data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
No exact meeting-location marker is included. This is a neighborhood overview.
"""
import math
import pathlib
import sys
import xml.etree.ElementTree as ET
from html import escape

root = ET.parse(sys.argv[1]).getroot()
west, south, east, north = -122.422, 37.757, -122.407, 37.770
width = 1600
scale = width / ((east - west) * math.cos(math.radians((north + south) / 2)))
height = (north - south) * scale
nodes = {n.attrib['id']: (float(n.attrib['lon']), float(n.attrib['lat'])) for n in root.findall('node')}

def project(point):
    lon, lat = point
    return ((lon - west) * math.cos(math.radians((north + south) / 2)) * scale, (north - lat) * scale)

def path(points, close=False):
    return 'M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in points) + ('Z' if close else '')

buildings, greens, roads, labels = [], [], [], {}
for way in root.findall('way'):
    tags = {t.attrib['k']: t.attrib['v'] for t in way.findall('tag')}
    points = [project(nodes[n.attrib['ref']]) for n in way.findall('nd') if n.attrib['ref'] in nodes]
    if len(points) < 2:
        continue
    if tags.get('leisure') in ('park', 'garden', 'playground') or tags.get('landuse') in ('grass', 'recreation_ground'):
        greens.append(f'<path d="{path(points, True)}"/>')
    if 'building' in tags:
        buildings.append(f'<path d="{path(points, True)}"/>')
    road_type = tags.get('highway')
    if road_type not in ('residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street', 'pedestrian'):
        continue
    road_width = {'primary': 16, 'secondary': 13, 'tertiary': 11}.get(road_type, 9)
    roads.append(f'<path d="{path(points)}" stroke-width="{road_width}"/>')
    name = tags.get('name', '')
    length = sum(math.hypot(b[0]-a[0], b[1]-a[1]) for a,b in zip(points,points[1:]))
    if name and length > labels.get(name, (0, []))[0]:
        labels[name] = (length, points)

text = []
for name, (length, points) in labels.items():
    if length < 220:
        continue
    a, b = points[0], points[-1]
    x, y = (a[0]+b[0])/2, (a[1]+b[1])/2
    if not (70 < x < width-70 and 70 < y < height-70):
        continue
    angle = math.degrees(math.atan2(b[1]-a[1], b[0]-a[0]))
    if angle > 90: angle -= 180
    if angle < -90: angle += 180
    text.append(f'<text x="{x:.1f}" y="{y-4:.1f}" transform="rotate({angle:.1f} {x:.1f} {y:.1f})">{escape(name)}</text>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height:.1f}" role="img" aria-label="Top-down map of the Mission District, San Francisco">
<title>Mission District, San Francisco</title>
<desc>Neighborhood overview, not an exact meeting-location map. Data © OpenStreetMap contributors, ODbL.</desc>
<rect width="100%" height="100%" fill="#f0f2ec"/>
<g fill="#d7e3cd">{''.join(greens)}</g>
<g fill="#dfe4da" stroke="#d7ddd1" stroke-width=".7">{''.join(buildings)}</g>
<g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">{''.join(roads)}</g>
<g font-family="system-ui,sans-serif" font-size="12" fill="#8a9581" text-anchor="middle">{''.join(text)}</g>
</svg>'''
out = pathlib.Path(__file__).resolve().parents[1] / 'app' / 'neighborhood.svg'
out.write_text(svg)
print(f'{out}: {len(buildings)} building footprints, {len(roads)} road segments, {len(text)} labels')
