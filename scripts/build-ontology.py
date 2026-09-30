"""Extract the IFC relationships used by the browser graph from the active IFC.

The graph keeps explicit IFC relation names. Visual class groupings are derived
from the related elements' IFC entity classes and are identified as such in UI.
"""

import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IFC = ROOT / "sample-model" / "three-storey-demo.ifc"
MANIFEST = ROOT / "public" / "elements.json"
OUTPUT = ROOT / "public" / "ifc-relationships.json"

ROOT_ENTITY = re.compile(r"^#(\d+)=(IFC[A-Z0-9_]+)\('((?:''|[^'])*)'")
ENTITY = re.compile(r"^#(\d+)=(IFC[A-Z0-9_]+)\((.*)\);$")
REFERENCE = re.compile(r"#(\d+)")
RELATIONS = {
    "IFCRELAGGREGATES": "IfcRelAggregates",
    "IFCRELCONTAINEDINSPATIALSTRUCTURE": "IfcRelContainedInSpatialStructure",
    "IFCRELDEFINESBYTYPE": "IfcRelDefinesByType",
    "IFCRELASSIGNSTOGROUP": "IfcRelAssignsToGroup",
}
SPATIAL_TYPES = {"IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE"}
SPATIAL_NAMES = {"IFCPROJECT": "IfcProject", "IFCSITE": "IfcSite", "IFCBUILDING": "IfcBuilding", "IFCBUILDINGSTOREY": "IfcBuildingStorey", "IFCSPACE": "IfcSpace"}


def split_fields(body):
    fields, start, depth, quoted, i = [], 0, 0, False, 0
    while i < len(body):
        char = body[i]
        if char == "'":
            if quoted and i + 1 < len(body) and body[i + 1] == "'":
                i += 2
                continue
            quoted = not quoted
        elif not quoted:
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            elif char == "," and depth == 0:
                fields.append(body[start:i])
                start = i + 1
        i += 1
    fields.append(body[start:])
    return fields


def step_string(value):
    value = value.strip()
    return value[1:-1].replace("''", "'") if value.startswith("'") and value.endswith("'") else ""


def ref(value):
    match = REFERENCE.search(value)
    return int(match.group(1)) if match else None


def refs(value):
    return [int(match) for match in REFERENCE.findall(value)]


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    visible = {entry["guid"]: entry for entry in manifest["elements"]}
    roots = {}
    raw_relations = []

    with IFC.open(encoding="utf-8", errors="replace") as stream:
        for line in stream:
            line = line.strip()
            root = ROOT_ENTITY.match(line)
            if root:
                step_id, kind, guid = int(root.group(1)), root.group(2), root.group(3)
                if kind not in RELATIONS:
                    entity = ENTITY.match(line)
                    if entity:
                        fields = split_fields(entity.group(3))
                        roots[step_id] = {
                            "guid": guid,
                            "ifcClass": SPATIAL_NAMES.get(kind, "Ifc" + kind[3:].title().replace(" ", "")),
                            "name": step_string(fields[2]) if len(fields) > 2 else "",
                        }
            if any("=" + kind + "(" in line for kind in RELATIONS):
                entity = ENTITY.match(line)
                if entity:
                    raw_relations.append((entity.group(2), split_fields(entity.group(3))))

    # Preserve IFC class spelling from the renderable model index when available.
    for record in roots.values():
        entry = visible.get(record["guid"])
        if entry:
            record["ifcClass"] = entry["type"]
            record["name"] = entry["name"]

    aggregates, containment, type_links, group_links = [], [], [], []
    for kind, fields in raw_relations:
        if kind == "IFCRELAGGREGATES" and len(fields) >= 6:
            parent = ref(fields[4])
            aggregates.extend((parent, child) for child in refs(fields[5]))
        elif kind == "IFCRELCONTAINEDINSPATIALSTRUCTURE" and len(fields) >= 6:
            structure = ref(fields[5])
            containment.extend((structure, element) for element in refs(fields[4]))
        elif kind == "IFCRELDEFINESBYTYPE" and len(fields) >= 6:
            type_id = ref(fields[5])
            type_links.extend((type_id, element) for element in refs(fields[4]))
        elif kind == "IFCRELASSIGNSTOGROUP" and len(fields) >= 6:
            group_id = ref(fields[-1])
            group_links.extend((group_id, element) for element in refs(fields[4]))

    spatial_ids = {step_id for step_id, record in roots.items() if record["ifcClass"].upper() in SPATIAL_TYPES}
    spatial = [dict(stepId=step_id, **roots[step_id]) for step_id in sorted(spatial_ids)]
    spatial_edges = [
        {"from": roots[parent]["guid"], "to": roots[child]["guid"], "relation": "IfcRelAggregates"}
        for parent, child in aggregates
        if parent in spatial_ids and child in spatial_ids
    ]
    spatial_parent = {child: parent for parent, child in aggregates if parent in spatial_ids and child in spatial_ids}

    def storey_for(structure):
        visited = set()
        while structure in spatial_ids and structure not in visited:
            if roots[structure]["ifcClass"] == "IfcBuildingStorey":
                return roots[structure]["guid"]
            visited.add(structure)
            structure = spatial_parent.get(structure)
        return None

    element_by_id = {step_id: record["guid"] for step_id, record in roots.items() if record["guid"] in visible}
    elements = {
        guid: {"guid": guid, "ifcClass": entry["type"], "name": entry["name"], "container": None, "storey": None, "type": None, "systems": []}
        for guid, entry in visible.items()
    }
    for structure, element in containment:
        guid = element_by_id.get(element)
        if guid and structure in spatial_ids:
            elements[guid]["container"] = roots[structure]["guid"]
            elements[guid]["storey"] = storey_for(structure)
    types = {}
    for type_id, element in type_links:
        guid = element_by_id.get(element)
        if guid and type_id in roots:
            type_record = roots[type_id]
            elements[guid]["type"] = type_record["guid"]
            types[type_id] = dict(stepId=type_id, **type_record)
    systems = {}
    for group_id, element in group_links:
        guid = element_by_id.get(element)
        if guid and group_id in roots:
            group = roots[group_id]
            elements[guid]["systems"].append(group["guid"])
            systems[group_id] = dict(stepId=group_id, **group)

    output = {
        "source": IFC.name,
        "schema": manifest["schema"],
        "spatial": spatial,
        "spatialEdges": spatial_edges,
        "types": list(types.values()),
        "systems": list(systems.values()),
        "elements": list(elements.values()),
        "relations": {
            "spatial": "IfcRelAggregates",
            "containment": "IfcRelContainedInSpatialStructure",
            "type": "IfcRelDefinesByType",
            "system": "IfcRelAssignsToGroup",
        },
    }
    OUTPUT.write_text(json.dumps(output, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    counts = Counter(entry["storey"] for entry in elements.values())
    print(json.dumps({"spatialNodes": len(spatial), "spatialEdges": len(spatial_edges), "containedVisibleElements": sum(count for key, count in counts.items() if key), "unassignedVisibleElements": counts[None], "typedVisibleElements": sum(bool(e["type"]) for e in elements.values()), "systemAssignedVisibleElements": sum(bool(e["systems"]) for e in elements.values()), "outputBytes": OUTPUT.stat().st_size}, indent=2))


if __name__ == "__main__":
    main()
