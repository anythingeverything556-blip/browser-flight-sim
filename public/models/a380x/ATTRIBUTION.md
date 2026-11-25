# FlyByWire A380X original 3D asset attribution

Copyright © FlyByWire Simulations and the original FlyByWire A380X 3D asset contributors.

Original aircraft project: https://flybywiresim.com/projects/a380x/
Original source/distribution project: https://github.com/flybywiresim/aircraft
Original licensing notice: https://github.com/flybywiresim/aircraft#license
Licensing/attribution guidance: https://flybywiresim.com/licenses/
License for original 3D assets: **Creative Commons Attribution–NonCommercial 4.0 International (CC BY-NC 4.0)**: https://creativecommons.org/licenses/by-nc/4.0/
Legal code: https://creativecommons.org/licenses/by-nc/4.0/legalcode

## Modifications

This is a modified browser-compatible visual conversion for Earthwing, not an official FlyByWire release or simulator port. The compiled Asobo accessor representations were interpreted and repacked as conventional glTF geometry; binary buffers were split for hosting limits. The native texture tier copies the referenced original DDS files **byte for byte**, retaining dimensions and mipmaps. Original node names, scene graph, skins and animation samples are retained. No geometry decimation, texture resizing or lossy texture re-encoding was performed.

Simulator-specific material metadata is retained in extras, while materials are approximated as Three/glTF PBR; glass and invisible occluders have browser display adaptations. BC5 signed tangent-space normals require positive-Z reconstruction and DirectX-Y conversion in the provided material adapter. Optional PNG compatibility generation (not the deployed default) uses full-resolution DDS decoding and lossless PNG, with normal reconstruction.

No endorsement or affiliation by FlyByWire Simulations, Airbus, Asobo Studio, or Microsoft is implied. Preserve this attribution and license notice when redistributing. Original 3D assets and their adaptations remain subject to the noncommercial restriction.

## Redistribution scope and provenance

Only the exterior/cockpit LOD00 glTF/bin visuals and textures actually referenced by those visuals from the official FlyByWire A380X stable 4K distribution were selected. The cockpit source includes the actual modeled passenger cabin; it is not fabricated or substituted. DDS source filenames and SHA-256 hashes are inventoried in native-manifest.json, source model hashes in manifest.json / geometry-manifest.json, and exhaustive equality evidence in source-fidelity-verification.json.

The source project's README expressly distinguishes original FlyByWire 3D assets (CC BY-NC 4.0) from code (GPLv3) and Microsoft assets (Microsoft rules). The source selected here is the original FlyByWire A380X model, not A32NX stock simulator model content. No MSFS base-install files, stock aircraft files, executable/avionics code, gauges, software, audio, simulator ModelBehavior XML, effects runtime, or simulator-owned package content are included. This is a visual asset conversion, not a reproduction of FlyByWire avionics behavior.
