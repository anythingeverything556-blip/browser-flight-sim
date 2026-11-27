# SR-71 native comparison: offline evidence preflight

This is a preparation tool for gap 4 in `SR71-WHAT-IS-LEFT.md`, **not a
solution to the four parity gaps**. It records/checks evidence for:

1. Original visual afterburner and other MSFS-only effects (including heat
   tracks and fuel leak/puddle helpers).
2. Exact analog gauges and complete systems, including the simulator-hosted
   airspeed/Mach, IVSI and barometric-altimeter behavior and missing systems.
3. Complete original audio routing, effects, spatialization and events.
4. A repeatable browser-versus-licensed-native comparison record.

## Run locally

Requires Node 20+ and built-ins only; no install, build, browser or MSFS session.

```sh
node tools/sr71-native-parity-preflight.mjs /absolute/path/to/private-evidence
node test/sr71-native-parity-preflight-test.mjs
```

The operator explicitly supplies one directory. The CLI reads only its
`record.json` and the evidence files listed there, and prints a JSON report to
stdout. It does not write files, follow symbolic links or remote references,
scan the project/host, launch software, use credentials, download, make network
requests, or deploy. Redirect stdout to a file **outside that evidence directory**
if a durable report is wanted. Keep recordings and license/private data local.

Exit codes: **0 = ready-for-review**, **1 = blocked** (invalid/missing record,
missing/empty/changed evidence, absent areas/cases or inconsistent captures),
**2 = incorrect command usage**. Exit 0 is never a parity or release gate.

## Input contract (schema version 1)

`record.json` is an object with these fields:

| Field | Required contents |
| --- | --- |
| `schemaVersion` | `1` |
| `comparisonId`, `operator`, `planId` | Nonempty strings identifying comparison, responsible operator and fixed scenario plan/version |
| `browser` | `runId`, `buildId`, `browserVersion`, `os`, `gpu` (nonempty strings) |
| `native` | `runId`, `buildId`, `platform: "Windows"`, `simulator: "MSFS 2024"`, `windowsVersion`, `simulatorBuild`, `addonBuild`, `gpu`, `licensedUseAttested: true` |
| `requiredCases` | Nonempty array of `{id, area, procedure}`; unique nonempty IDs/procedures, area is `effects`, `analog-systems` or `audio`; all three areas required |
| `cases` | Exactly one paired capture case per planned ID, with matching area and the structure below |

Each baseline `buildId` identifies the precise captured build (prefer a commit
plus artifact hash for Earthwing, and explicit simulator/add-on version plus a
locally recorded package identifier for native). `runId`s identify distinct
browser/native capture runs; both sides use the same `comparisonId` and case IDs.
Versions and license use are **operator declarations**, not auto-discovered or
verified facts. Licensed use says nothing about redistribution permission.

One **illustrative** paired case (not actual evidence; replace all placeholders,
and supply the remaining planned cases/areas):

```json
{
  "id": "effects-afterburner-aft-v1",
  "area": "effects",
  "conditions": {
    "location": { "latDeg": 0, "lonDeg": 0, "altitudeMslFt": 0 },
    "weather": { "preset": "record exact preset, wind and visibility" },
    "timeUtc": "2026-11-26T12:00:00Z",
    "aircraftState": { "configuration": "record fuel, engines, controls and timeline" },
    "camera": { "view": "record pose, FOV, resolution, exposure and graphics settings" },
    "audioSettings": { "capture": "record viewpoint, volume, device, rate and channels" }
  },
  "browser": {
    "comparisonId": "copy top-level comparisonId",
    "caseId": "effects-afterburner-aft-v1",
    "runId": "copy browser.runId",
    "buildId": "copy browser.buildId",
    "conditions": { "replace": "exact copy of the scenario conditions above" },
    "evidence": [{ "path": "captures/browser-afterburner.mp4", "sha256": "replace with actual 64-character lowercase SHA-256" }]
  },
  "native": {
    "comparisonId": "copy top-level comparisonId",
    "caseId": "effects-afterburner-aft-v1",
    "runId": "copy native.runId",
    "buildId": "copy native.buildId",
    "conditions": { "replace": "exact copy of the scenario conditions above" },
    "evidence": [{ "path": "captures/native-afterburner.mp4", "sha256": "replace with actual 64-character lowercase SHA-256" }]
  }
}
```

Each case needs nonempty `location`, `weather`, `aircraftState`, `camera` and
`audioSettings` objects, plus a UTC `timeUtc` string. Both captures must declare
the exact same conditions (object key order is irrelevant). The fields are
extensible; record units and all relevant conditions, not just the example keys.
The `procedure` in the plan describes the inputs, timing, observations and
reference/tolerances to be reviewed. Missing, duplicate, additional or mismatched
cases block. Conditions describe scenario time, not wall-clock capture time.

Evidence paths must be relative regular files inside the supplied directory:
no URL, absolute path, backslash, colon, traversal or symbolic link. Every file
must be nonempty and match its declared SHA-256. Files are hashed as bytes, never
executed or decoded. Original recordings, telemetry, provenance notes and a
reviewer's measurement references can be listed together per capture. The
record and evidence hashes bind a report to those bytes; changing them requires
a new report. Preserve `record.json`, listed files and stdout together privately.

## Human sign-off remains mandatory

The report includes operator, plan, run/build metadata, record SHA-256, evidence
hashes/sizes, four gap statuses and specific blockers. A successful report says
`ready-for-review`, with `parityVerified`, `deploymentAuthorized`,
`licenseVerified` and `redistributionPermissionVerified` all **false**.

The CLI checks declarations, presence and consistency only. Arbitrary text or
synthetic files can pass; file presence cannot prove the contents show MSFS,
licensed use, matching conditions, correctness, coverage or numerical equality.
The tests deliberately demonstrate that distinction using synthetic files only.

A qualified reviewer must first agree a complete scenario matrix, then inspect
native and browser captures and record reference measurements, tolerances,
limitations and an explicit decision against the exact recorded builds. At least
one case per area is only a structural minimum, not proof of full effects,
systems or audio coverage. Suggested coverage includes burner transitions/heat/
leaks; gauge sweeps, failures, WALT and systems; cockpit/aft/other sound views,
start/stop/burner transitions, routing/effects and event completeness. Missing
runtime access, editable sources, evidence or rights remains a real blocker;
this tool does not obtain or bypass any of them. No native software or assets
were accessed, converted or changed to implement it.
