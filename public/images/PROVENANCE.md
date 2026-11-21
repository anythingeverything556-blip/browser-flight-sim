# Earthwing visual assets — 21 November 2026

`earthwing-flight-4k.mp4` is an original representational Three.js model film, not a flight screenshot, real-world photograph or stock video. It uses the unchanged repository SR-71 model/materials with original procedural sky/cloud shading and a moving periodic camera. No third-party imagery was added. The existing repository licence/credits continue to apply to models; LICENSE files are unchanged.

Source: `tools/render-release-art.mjs` (run against the local dev server with `ART_OUTPUT` outside the repository). Chrome/ANGLE SwiftShader rendered 144 separate **3840×2160** frames; 24 fps, six seconds, no source upscaling. Periodic camera parallax, highlights and cloud coordinates change every frame. The poster is a native render of the same scene. Smaller posters and the 1080p film are downsampled derivatives. The legacy 640×360 `mach3-hero.jpg` remains for URL compatibility only.

Encoding recipe (FFmpeg; no new application dependency):

```sh
ffmpeg -framerate 24 -i "$ART_OUTPUT/frames/%04d.jpg" -frames:v 144 -c:v libx264 -threads 2 -preset medium -crf 25 -pix_fmt yuv420p -an -movflags +faststart earthwing-flight-4k.mp4
```

The 1080p derivative adds `-vf scale=1920:1080`. WebP posters use quality 83 at 3840×2160 and 1920×1080, quality 82 at 960×540. Small cards use 480×270 WebP quality 86, downsampled from freshly rendered aircraft masters. Large SR-71 art is a 1280×720 native crop (`+80+56`) of the 1920×1080 render; the other large aircraft renders are 1920×1080. All subjects use repository models, brighter three-point lighting, and no new geometry or texture imports.

4K H.264: 1,382,831 bytes; 1080p H.264: 349,294 bytes. No audio track. Actual source and decoded-frame hashes and local browser proofs are retained privately under the release evidence folder, not shipped to players. Phones, reduced-motion, Save-Data and slow reported connections intentionally use only a responsive poster; playback denial/failure also falls back to the poster.
