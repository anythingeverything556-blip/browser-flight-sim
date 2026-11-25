# Supplied Bgt Air Inter 1980 livery — rights and provenance

This staging uses only files in the user-supplied `1-bgt-f27500-v2_Sdqt0.zip`, extracted to `fokker-f27-inspection/bgt-f27500-v2/`. No unrelated liveries, downloaded graphics, generated logos, invented markings, or replacement aircraft meshes are included.

Selected variant: `SimObjects/Airplanes/Bgt_F27500v2/aircraft.cfg` `[FLTSIM.1]`, `ui_variation = "Air Inter 1980 Classic"`, `texture = "it80"`, `ui_createdby = "Bgt"`. The supplied 1968 and 1980 thumbnails are retained together in evidence; 1980 has the richer blue stripe treatment and red/blue tail, with a complete T2–T7 albedo set. Documentation describes the author’s Air Inter configuration and the aircraft.cfg loading text records Air Inter operating seven F27-500s from 1968. No independent historical claim about this particular airframe’s exact paint date was added.

Important supplied discrepancy: the painted T5 atlas reads **F-BPNB**, whereas aircraft.cfg has `atc_id = "F-BPNA"` for this variant. The author’s painted F-BPNB is retained unchanged. Do not label the rendered texture as F-BPNA or fabricate replacement registration text.

## Author’s terms, not an open-source license

Source: `Documentation/f27500it-bgt_v23_doc_en2.pdf`, printed page 65, “LEGAL INFOS”; extracted text `fokker-f27-inspection/f27500it-bgt_v23_doc_en2.txt`, lines 2941–2955:

> THIS PLANE (3D MODEL + FLIGHT DYNAMICS), 3D COCKPIT, 2D PANEL AS WELL AS THE INCLUDED COCKPIT SOUNDS AND ENGINE SOUNDS ARE STRICTLY FREEWARE. ANY COMMERCIAL / BUSINESS / PAYWARE USE (INCLUDING SHAREWARE) OF THIS ARCHIVE OR PART OF IT IS NOT ALLOWED.
>
> I ACCEPT NO RESPONSIBILITY IN ANY DAMAGE RESULTING FROM USING THOSE FILES.
>
> DATAS GIVEN IN THIS DOCUMENT ARE NOT AVAILABLE FOR REAL AVIATION.
>
> Benoit Gaurant
> bgaurant@free.fr

The PDF uses stylized letter casing; the quote above normalizes casing only. The French documentation repeats the prohibition at printed page 65. This is **not a permissive redistribution/commercial license**. Private local noncommercial staging is the scope here. No public/commercial deployment or general redistribution permission is asserted or granted by this conversion. Any intended commercial/business/shareware release would need different rights from the author. This task did not contact anyone or deploy anything.

## Source resolution

- Colored variant `texture.it80/texture.CFG`: fallback.1 = `..\\texture.vcit`, fallback.2 = `..\\texture.common`.
- White variant `texture.white/texture.CFG`: fallback.1 = `..\\texture.vcen`, fallback.2 = `..\\texture`, fallback.3 = `..\\texture.common`.
- All selected colored T2–T7 ALBD DDS files exist directly in `texture.it80`. White shell reference T2–T7 is in `texture/`, not `texture.white/`.
- No `texture.vcit` panel atlas was imported: current English cockpit instruments/placards stay unchanged.
- The PROP albedo is byte-identical between it80 and white; it is intentionally not copied.

`livery-manifest.json` inventories source SHA-256, converted SHA-256, native dimensions, bytes, GLTF image/material candidates, and fidelity/orientation checks. WebP is a lossy browser conversion at q94, alpha quality 100; decoded source PNGs in `evidence/` are QA references, not shipped runtime duplicates.
