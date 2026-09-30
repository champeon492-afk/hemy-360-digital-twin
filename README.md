# HEMY 360 sample digital twin viewer

This public demonstration uses a **synthetic** three-storey IFC4 building. The model is generated from code in this repository. It does not contain a real facility model, project coordinates, equipment inventory, or live operational data.

The sample includes 158 renderable IFC elements in six IFC classes. It has one `IfcProject`, one `IfcSite`, one `IfcBuilding`, and three `IfcBuildingStorey` entities. Its elements use `IfcRelContainedInSpatialStructure` for storey containment and `IfcRelDefinesByType` for type relationships. The interactive graph is derived from those IFC relationships.

## View locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:4173/`. The optimized geometry is `public/three-storey-demo.frag`; its source is `sample-model/three-storey-demo.ifc`. `npm run build` writes the local static site to `dist/`.

## Regenerate the synthetic model

The generator requires Python with IfcOpenShell and NumPy. On this development machine those packages are bundled with Blender 5.2.

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/generate-sample-ifc.py
node scripts/convert-ifc.mjs sample-model/three-storey-demo.ifc public/three-storey-demo.frag
node scripts/extract-fragment-items.mjs public/three-storey-demo.frag sample-model/fragment-items.json
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/build-manifest.py -- sample-model/three-storey-demo.ifc sample-model/fragment-items.json public/elements.json
python scripts/build-ontology.py
npm run build
```

`npm run build:pages` writes the GitHub Pages version to `docs/`. The source IFC, optimized geometry, and relationship metadata in this repository are all synthetic.

## Interface

- Orbit, pan, zoom, click an element, or use search suggestions to focus it. Selection uses an edge glow.
- Spatial view traces project → site → building → storey → IFC class → element.
- Types view traces IFC class → type definition → element. Switching views retains the selected element and its path.
- Storey, class, and type nodes highlight their linked renderable elements.
- The model toolbar offers Fit, Top, Explode, Section, level filtering, and Mesh.

Telemetry, incidents, analytics, simulation, GIS, controls, and integrations are local demonstrations. They are not connected to Microsoft Fabric or physical equipment. VR/AR controls report availability but immersive mode is not implemented.
