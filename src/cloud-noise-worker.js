import { makeCloudNoise } from './cloud-noise.js';
const n = makeCloudNoise();
postMessage(n, [n.shape.buffer, n.detail.buffer]);
