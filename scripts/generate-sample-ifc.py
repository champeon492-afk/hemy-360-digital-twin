"""Generate a synthetic IFC4 building for the public HEMY 360 demonstration.

Run with Blender's Python environment, which includes IfcOpenShell.
Every element, name, GUID, and coordinate is generated here; no source model is read.
"""

from pathlib import Path

import ifcopenshell.api
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "sample-model" / "three-storey-demo.ifc"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

model = ifcopenshell.api.run("project.create_file", version="IFC4")
project = ifcopenshell.api.run("root.create_entity", model, ifc_class="IfcProject", name="Synthetic Three Storey Demo")
length = ifcopenshell.api.run("unit.add_si_unit", model, unit_type="LENGTHUNIT")
area = ifcopenshell.api.run("unit.add_si_unit", model, unit_type="AREAUNIT")
volume = ifcopenshell.api.run("unit.add_si_unit", model, unit_type="VOLUMEUNIT")
ifcopenshell.api.run("unit.assign_unit", model, units=[length, area, volume])
model_context = ifcopenshell.api.run("context.add_context", model, context_type="Model")
body = ifcopenshell.api.run(
    "context.add_context", model, context_type="Model", context_identifier="Body",
    target_view="MODEL_VIEW", parent=model_context,
)

site = ifcopenshell.api.run("root.create_entity", model, ifc_class="IfcSite", name="Demo Site")
building = ifcopenshell.api.run("root.create_entity", model, ifc_class="IfcBuilding", name="Sample Building")
ifcopenshell.api.run("aggregate.assign_object", model, products=[site], relating_object=project)
ifcopenshell.api.run("aggregate.assign_object", model, products=[building], relating_object=site)
storeys = []
for index, elevation in enumerate((0.0, 3.6, 7.2), start=1):
    storey = ifcopenshell.api.run(
        "root.create_entity", model, ifc_class="IfcBuildingStorey", name=f"Level {index}"
    )
    storey.Elevation = elevation
    ifcopenshell.api.run("aggregate.assign_object", model, products=[storey], relating_object=building)
    storeys.append(storey)

types = {}
for ifc_class, type_class, name in (
    ("IfcSlab", "IfcSlabType", "Floor slab"),
    ("IfcWall", "IfcWallType", "Exterior wall"),
    ("IfcColumn", "IfcColumnType", "Concrete column"),
    ("IfcWindow", "IfcWindowType", "Facade glazing"),
    ("IfcDoor", "IfcDoorType", "Entrance door"),
    ("IfcRoof", "IfcRoofType", "Flat roof"),
):
    types[ifc_class] = ifcopenshell.api.run("root.create_entity", model, ifc_class=type_class, name=name)

styles = {}
for key, rgb, transparency in (
    ("floor", (0.63, 0.68, 0.67), 0.0),
    ("wall", (0.87, 0.88, 0.80), 0.0),
    ("column", (0.42, 0.48, 0.46), 0.0),
    ("glass", (0.29, 0.56, 0.66), 0.3),
    ("door", (0.78, 0.45, 0.19), 0.0),
    ("roof", (0.30, 0.37, 0.38), 0.0),
):
    style = ifcopenshell.api.run("style.add_style", model, name=f"Demo {key}")
    ifcopenshell.api.run(
        "style.add_surface_style", model, style=style, ifc_class="IfcSurfaceStyleShading",
        attributes={
            "SurfaceColour": {"Name": None, "Red": rgb[0], "Green": rgb[1], "Blue": rgb[2]},
            "Transparency": transparency,
        },
    )
    styles[key] = style

faces = [[
    (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
    (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
]]
element_count = 0


def box(ifc_class, name, storey, x, y, z, width, depth, height, style):
    global element_count
    product = ifcopenshell.api.run("root.create_entity", model, ifc_class=ifc_class, name=name)
    vertices = [[
        (0.0, 0.0, 0.0), (width, 0.0, 0.0), (width, depth, 0.0), (0.0, depth, 0.0),
        (0.0, 0.0, height), (width, 0.0, height), (width, depth, height), (0.0, depth, height),
    ]]
    representation = ifcopenshell.api.run(
        "geometry.add_mesh_representation", model, context=body, vertices=vertices, faces=faces
    )
    ifcopenshell.api.run("geometry.assign_representation", model, product=product, representation=representation)
    ifcopenshell.api.run(
        "style.assign_representation_styles", model, shape_representation=representation, styles=[styles[style]]
    )
    matrix = np.eye(4)
    matrix[:3, 3] = (x, y, z)
    ifcopenshell.api.run("geometry.edit_object_placement", model, product=product, matrix=matrix)
    ifcopenshell.api.run("spatial.assign_container", model, products=[product], relating_structure=storey)
    ifcopenshell.api.run(
        "type.assign_type", model, related_objects=[product], relating_type=types[ifc_class],
        should_map_representations=False,
    )
    element_count += 1


for level, storey in enumerate(storeys, start=1):
    z = (level - 1) * 3.6
    box("IfcSlab", f"Level {level} floor", storey, -15, -9, z - 0.28, 30, 18, 0.28, "floor")

    # Segmented south and north facades leave real window and door openings.
    for side, y in (("south", -9.0), ("north", 8.7)):
        box("IfcWall", f"Level {level} {side} sill", storey, -15, y, z, 30, 0.3, 0.8, "wall")
        box("IfcWall", f"Level {level} {side} header", storey, -15, y, z + 2.9, 30, 0.3, 0.7, "wall")
        for bay in range(6):
            x = -15 + bay * 5
            box("IfcColumn", f"Level {level} {side} pier {bay + 1}", storey, x, y, z, 0.4, 0.4, 3.6, "column")
            if side == "south" and level == 1 and bay == 2:
                box("IfcDoor", "Main entrance", storey, x + 0.45, y + 0.12, z + 0.8, 2.0, 0.12, 2.1, "door")
                box("IfcWindow", "Entrance sidelight", storey, x + 2.55, y + 0.12, z + 0.8, 2.0, 0.12, 2.1, "glass")
            else:
                box("IfcWindow", f"Level {level} {side} window {bay + 1}", storey,
                    x + 0.45, y + 0.12, z + 0.8, 4.1, 0.12, 2.1, "glass")

    for side, x in (("west", -15.0), ("east", 14.7)):
        box("IfcWall", f"Level {level} {side} sill", storey, x, -9, z, 0.3, 18, 0.8, "wall")
        box("IfcWall", f"Level {level} {side} header", storey, x, -9, z + 2.9, 0.3, 18, 0.7, "wall")
        for bay in range(3):
            y = -9 + bay * 6
            box("IfcColumn", f"Level {level} {side} pier {bay + 1}", storey,
                x, y, z, 0.4, 0.4, 3.6, "column")
            box("IfcWindow", f"Level {level} {side} window {bay + 1}", storey,
                x + 0.12, y + 0.45, z + 0.8, 0.12, 5.1, 2.1, "glass")

    for x in (-10, 0, 10):
        for y in (-4, 4):
            box("IfcColumn", f"Level {level} interior column {x},{y}", storey,
                x, y, z, 0.45, 0.45, 3.6, "column")
    box("IfcWall", f"Level {level} core wall", storey, -3, -2, z, 0.3, 4, 3.6, "wall")

box("IfcRoof", "Flat roof", storeys[-1], -15.4, -9.4, 10.8, 30.8, 18.8, 0.45, "roof")

model.write(str(OUTPUT))
print(f"Wrote synthetic IFC4 building: {OUTPUT} ({element_count} renderable elements)", flush=True)
