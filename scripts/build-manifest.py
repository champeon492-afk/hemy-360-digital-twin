"""Join renderable Fragments items to their source IFC names and classes.

Run with Blender's Python environment, which has IfcOpenShell installed:
blender --background --python scripts/build-manifest.py -- source/model.ifc source/frag-items.json public/elements.json
"""

import json
import math
import sys
from collections import Counter
from pathlib import Path

import ifcopenshell


source, items_path, output_path = map(Path, sys.argv[sys.argv.index("--") + 1:][:3])
items = json.loads(items_path.read_text(encoding="utf-8"))
model = ifcopenshell.open(str(source))
products = {item.GlobalId: item for item in model.by_type("IfcProduct") if item.GlobalId}
elements = []
counts = Counter()
unmatched = 0
minimum = [math.inf] * 3
maximum = [-math.inf] * 3

for record in items:
    product = products.get(record["guid"])
    if product is None:
        unmatched += 1
        continue
    position = record["position"]
    # Manifest consumers expect the vertical coordinate in the third slot.
    # Fragments uses Y-up, so store placement as [X, Z, Y].
    point = [position["x"], position["z"], position["y"]]
    if not all(math.isfinite(value) for value in point):
        unmatched += 1
        continue
    category = product.is_a()
    elements.append({
        "guid": record["guid"],
        "type": category,
        "name": product.Name or record["name"] or category,
        "bounds": [point, point],
    })
    counts[category] += 1
    for axis in range(3):
        minimum[axis] = min(minimum[axis], point[axis])
        maximum[axis] = max(maximum[axis], point[axis])

manifest = {
    "source": source.name,
    "schema": model.schema,
    "boundsBasis": "fragment-placement",
    "originIfcMeters": None,
    "bounds": [minimum, maximum],
    "counts": dict(counts),
    "elements": elements,
    "skipped": [],
}
output_path.write_text(json.dumps(manifest, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
print(json.dumps({"renderable": len(elements), "unmatched": unmatched, "categories": dict(counts), "manifestBytes": output_path.stat().st_size}, indent=2), flush=True)
