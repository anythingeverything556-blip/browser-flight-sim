# Notices and attributions

The project authors' original work is covered by `LICENSE`. It does not grant
rights to third-party assets or recordings.
Everything below belongs to its respective owners and keeps its own terms.

## Aircraft model
The private owner-build SR-71 exterior and cockpit (`public/models/sr71/`)
contain converted third-party Milviz source assets supplied with this handoff,
as described in `README-SR71-INTEGRATION.md`. The original packages and
recordings remain subject to their rightsholders' terms. This notice does not
authorize public release. The earlier author-made `SR71_sim.glb` described in
historical notes is not the selected model in this owner build.

The Fokker F27 Mk500 (`public/models/f27/`) includes adaptations of Benoît
Gaurant's aircraft, textures, animations and recordings. See the dedicated
`public/models/f27/NOTICE.md` for original credit, terms, archive identity and
the private-handoff restriction.

`public/models/SF50.glb` (Vision Jet) was modelled in Blender by the project
authors with help from an AI assistant. It is an unofficial model: Cirrus,
Vision Jet and SF50 are trademarks of Cirrus Design Corporation, which has no
connection with this project.

`public/models/IL76_v6.glb` (Ilyushin Il-76MD-90A) was modelled in Blender by the
project authors with help from an AI assistant, from published dimensions and
reference photographs; no third-party 3D model, texture or sound recording is
included. It is an unofficial model: Ilyushin, Il-76 and United Aircraft
Corporation names and marks belong to their owners, which have no connection
with this project. The aircraft's sounds are synthesised in the browser.

The A380X visual model (`public/models/a380x/`) is adapted from the original
FlyByWire A380X, copyright FlyByWire Simulations and original 3D contributors:
https://flybywiresim.com/projects/a380x/. The original and converted assets
are CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/), not subject
to Earthwing's own asset license. Geometry was repacked for web glTF and
simulator-specific shaders adapted; the publisher does not endorse this port.
See `public/models/a380x/ATTRIBUTION.md` for the full notice.

The Diamond DA40 NG visual model (`public/models/da40/`) is adapted from
[Diamond DA40 NG for FlightGear](https://github.com/sryu1/DA40), with genuine
FG1000 display meshes from the FlightGear base package. The corresponding
source and original contributors are identified in
`public/models/da40/NOTICE.md`; the original GNU GPL v2 text is in
`public/models/da40/COPYING`. The DA40 aircraft assets remain under their
original terms, separate from Earthwing's own license.

## Map data (loaded live in the browser)
- Satellite imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics and
  the GIS User Community) and Esri World Imagery Wayback at selected airports.
  Official orthophoto services, credited as their licences require:
  - Europe: IGN France (Licence Ouverte); © IGN; Métropole de Lyon; Rennes
    Métropole; © Administration du cadastre et de la topographie (ACT),
    geoportail.lu; UrbIS © CIRB; © Digitaal Vlaanderen; Source : Service
    public de Wallonie (SPW); PDOK Netherlands (CC BY 4.0); © Geobasis NRW;
    Stadt Köln; Regionalverband Ruhr; Senatsverwaltung für Stadtentwicklung,
    Bauen und Wohnen Berlin / TrueDOP 2024; Freie und Hansestadt Hamburg, LGV;
    © GeoBasis-DE/LVermGeo SH/CC BY 4.0; Geobasisdaten © HVBG; © LVGL
    Saarland, dl-de/by-2-0; LGL-BW (2026) Datenlizenz Deutschland –
    Namensnennung – Version 2.0, www.lgl-bw.de; Bayerische
    Vermessungsverwaltung (CC BY 4.0); GeoBasis-DE / LVermGeoRP
    (dl-de/by-2.0); swisstopo (SWISSIMAGE, open government data); Données
    SITG; Quelle: Geodaten Kanton Basel-Stadt; basemap.at Austria (CC BY 4.0);
    Datenquelle: Stadt Wien – data.wien.gv.at; Datenquelle: Land Vorarlberg –
    data.vorarlberg.gv.at; Provincia autonoma di Bolzano; Comune di Bologna;
    ČÚZK Czechia (CC BY 4.0); Źródło: GUGiK (geoportal.gov.pl); Maa- ja
    Ruumiamet; Göteborgs Stad; PNOA cedido por © Instituto Geográfico
    Nacional; Origen de los datos: Ayuntamiento de Madrid; Institut
    Cartogràfic i Geològic de Catalunya (ICGC); Direção-Geral do Território.
  - North America: KyFromAbove; Government of the District of Columbia, OCTO;
    PEMA, via PASDA; CT ECO; © Gouvernement du Québec – MRNF; © King's Printer
    for Ontario, 2024.
  - South America: SDP / SIGLA S.A.S. / IDECA – UAECD; IDEuy – AGESIC,
    Licencia de Datos Abiertos – Uruguay.
  - Asia-Pacific: Geospatial Information Authority of Japan; NSW Spatial
    Services (CC BY 4.0); CCBY – Australian Capital Territory and Aerometrex;
    CC BY 3.0 AU © State of Tasmania; © State of Queensland (CC BY 4.0); ©
    Planet Labs Netherlands B.V. reproduced under licence from Planet and
    Geoplex, all rights reserved.
- Terrain elevation: AWS Terrain Tiles.
- 3D buildings: Overture Maps Foundation (includes OpenStreetMap data, (c)
  OpenStreetMap contributors, ODbL, plus Google and Microsoft building data).
- Land cover and vector tiles: OpenStreetMap contributors via OpenFreeMap.

## Software libraries
three, leaflet, pmtiles, pbf, @mapbox/vector-tile, earcut, Draco decoder
(Google) and Vite. Each is used under its own licence; see the package
metadata in `node_modules` or `package-lock.json`.

## Voice warnings
`public/audio/voice/` holds call-outs generated offline with `tools/make-voices.py`:
the English sets with Kokoro-82M (hexgrad, Apache-2.0), the Russian set with the
Piper voice ru_RU-denis-medium (rhasspy, CC0 training data).

## Fonts
`public/fonts/` holds Geist and Geist Mono (The Geist Project Authors, SIL Open Font License 1.1,
`public/fonts/OFL.txt`).

## Interface design method
The menu and overlay styling was revised with the unslop method by Damir Sokolovsky
(@heydamir), https://github.com/heydamir/unslop, licensed CC BY 4.0. No code or
images from it are included; the design is adapted from its guidance.
