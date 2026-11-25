# Blackbird unslop audit

Scope: heavy-ish slop in the chrome (every DOM surface), none in the scene or instruments. The app already has
a coherent token block and good icon-only dock, so this is a full pass over `src/style.css` and `index.html`,
not a rebuild. Sections and their order are unchanged.

Screens opened and captured before any change: loading/intro hero, flight setup (top, scrolled, bottom, Vision Jet picked),
terms and credits, full-screen loading screen, in-flight (rail, status, strip, throttle lever), rail tooltip, warn toast,
neutral toast, sheets (flight, map, airports, autopilot, views, weather, settings incl. keyboard controls, help),
first-flight guide, coach + mission panel, crash report, 1280x720, 390x844.

## Signs found, and where

| Sign (signs.md) | Where |
| --- | --- |
| **Surfaces: glass effects** | `backdrop-filter: blur(22px) saturate(140%)` on rail, status, strip, sheets, toasts, coach, guide, radio, lever, hero spec tiles, terms and crash overlays |
| **Surfaces: gradients, glows, coloured shadows** | CTA (orange gradient + orange glow shadow), hero `h1` gradient text + drop-shadow, `.hero-signal` dot glow, brand tile gradient, crash card top glow line, guide key `.hot` glow, throttle lever blink glow, loading bar gradient, throttle fill/AB/MIL gradients, `body.intro::before` scrim, loadscreen radial wash, `#flash` radial |
| **Surfaces: excessive tints** | accent-wash on every selected state, tinted green/amber/red pill backgrounds, per-element rgba whites at 5/7/9/12/14/16/22% |
| **Type: tracked uppercase labels** | `.lbl` (0.09em), `.eyebrow` (0.12em), `.field-meta`, `.h-kicker` (0.22em), `.hero-program` (0.2em), hero spec labels, `.seg-d label`, `.keys th`, `.prose h3`, `.terms-body h3`, `.km-head`, `.rmsg b`, `.tl-cap`, `#coach .coach-step`, `#mission .m-title`, guide step label, HTML text typed in capitals (`MISSION PLANNING`, `SELECT AIRFRAME`, `READY FOR SORTIE`…) |
| **Type: heavy weights, too many sizes** | 650/700/800/850 weights; sizes 8.5, 9.5, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 17, 19, 20, 22, 26, 30px; negative tracking on 28px strip numbers and `h2` |
| **Type: gradient headline** | `BLACKBIRD` hero wordmark |
| **Icons** | rail icons mix stroke widths (the Controls icon uses a 3.4 stroke bar); `×` text glyph for close; brand mark inside a gradient tile; `!` badge in a circle on the crash card; `▶` in the replay button; text glyph status chips (`◌ ● ❚❚ ✕`) |
| **Spacing** | off-grid values everywhere: 3, 5, 7, 9, 10, 11, 13, 14, 15, 18, 22, 26, 28, 30px; sibling rows with different heights (seg 38 / dial 36 / ghost 36 / chips 34) |
| **Copy** | `Search 7,000+ airports worldwide` is wrong (database has 8,285); field-meta captions that only restate the label (`SELECT AIRFRAME`, `SAVED AIRFIELD`, `OBJECTIVE`, `INITIAL CONDITIONS`…); `AI VOICE` (unsupported); hero `fly at the edge of the atmosphere`; hero spec tiles describe the SR-71 whatever aircraft is picked; setting rows are 150-character parenthetical sentences; `FLIGHT TERMINATED` eyebrow repeating the title; shouting status chips; `Getting the world ready…` |
| **Components** | everything is a full pill (status bar, chips, toasts, tags, annunciator) – radii not related to size; stat-card tiles for three hero facts; coloured glow pills for `ann`, `tag`, `pill` |
| **Motion** | infinite `tl-blink` on throttle lever, strip throttle cell, guide `.hot` key; `km-blink`; `.cta` hover lift; mixed `ease` / `linear` / 80–380 ms durations; `transition: transform` hover shifts; `g-in` 380 ms fly-in |
| **Template look** | Inter named but never loaded (system fallback), grey + one orange button |
| **Visuals** | no stock imagery. The hero relies on the live scene, which is correct; spec tiles are the only filler |

Not found: emoji used as icons, sparkles, fake social proof, badges, parallax, stock imagery.

## Direction

1. **Product:** Blackbird is a free, browser-based, 1:1-scale flight simulator with real satellite imagery, 8,200+ airports and three aircraft, for simulation and aviation enthusiasts.
2. **Character:** Instrument-grade and quiet — a matte avionics bezel, not a dashboard: flat blue-black panels, hairline rules, small sentence-case labels, numbers in tabular mono.
3. **World:** Cockpit avionics and charts at night. Neutrals tinted toward night-sky blue; colour keeps its glass-cockpit meaning (cyan selected or target, green engaged, amber caution, red warning).
4. **Moments:** The intro scene with the one-line wordmark and setup card, and the in-flight data strip. Everything else stays out of the way of the scene.
5. **Signature:** Cyan instrument selection ring and flat bezel panels on a hairline grid; one easing, no loops except live status.
