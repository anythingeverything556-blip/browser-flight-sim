# Notices and attributions

The authors' own code and the SR-71 model are covered by `LICENSE`.
Everything below belongs to its respective owners and keeps its own terms.

## Aircraft model
`public/models/SR71_sim.glb` was modelled in Blender by the project authors
with help from an AI assistant.

## Map data (loaded live in the browser)
- Satellite imagery: Esri World Imagery, and national orthophoto services for
  France (IGN), Bavaria, Rhineland-Palatinate, Flanders, Czechia, South Tyrol,
  New South Wales, Switzerland (swisstopo SWISSIMAGE, open government data),
  the Netherlands (PDOK, CC BY 4.0), Austria (basemap.at, CC BY 4.0) and Japan
  (Geospatial Information Authority of Japan seamless photo).
- Terrain elevation: AWS Terrain Tiles.
- 3D buildings: Overture Maps Foundation (includes OpenStreetMap data, (c)
  OpenStreetMap contributors, ODbL, plus Google and Microsoft building data).
- Land cover and vector tiles: OpenStreetMap contributors via OpenFreeMap.

## Software libraries
three, leaflet, pmtiles, pbf, @mapbox/vector-tile, earcut, Draco decoder
(Google) and Vite. Each is used under its own licence; see the package
metadata in `node_modules` or `package-lock.json`.
