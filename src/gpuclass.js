// GPU class from the WebGL renderer string (WEBGL_debug_renderer_info), for the first-run graphics preset only.
// ANGLE wraps it ("ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)"), Firefox rounds it ("Intel(R) HD Graphics, or similar").
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Software Rasterizer|Microsoft Basic Render|lavapipe/i;
// discrete parts whose names would otherwise match an integrated pattern below
const DISCRETE = /GeForce|NVIDIA|Quadro|RTX|Radeon\s*(\(TM\)\s*)?(RX|R9|R7|HD\s*[5-8]\d{3}|Pro|VII)|Radeon\s+\d{3,4}M?\s+Series|Arc\(TM\) A\d|Intel\(R\) Arc|Apple M\d+ (Pro|Max|Ultra)/i;
// integrated: Intel HD/UHD/Iris, AMD APUs (Radeon(TM) Graphics, 610M-890M, Vega 3-11), Apple M-series base and Apple GPU (Safari), mobile parts
const INTEGRATED = /Intel|Iris|UHD|HD Graphics|Radeon\(TM\)\s*Graphics|Radeon Graphics|Radeon\s*(\(TM\)\s*)?[6-8][0-9]0M|Radeon\s*(\(TM\)\s*)?Vega\s*\d+\s*Graphics|Vega \d+(?!\d)|Apple M\d+|Apple GPU|Mali|Adreno|PowerVR|Xclipse/i;

export function gpuClass(name) {
  const s = String(name || '');
  if (!s) return 'unknown';
  if (SOFTWARE.test(s)) return 'software';
  if (DISCRETE.test(s)) return 'discrete';
  if (INTEGRATED.test(s)) return 'integrated';
  return 'discrete';
}

// preset a first run starts on: High on discrete or unknown GPUs, Normal on integrated ones, Low on a software rasteriser
export const firstRunGfx = (name) => ({ integrated: 'normal', software: 'low' })[gpuClass(name)] || 'high';
