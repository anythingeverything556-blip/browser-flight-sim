import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { airframeSurfaces, restoreAirframeNormals } from '../tools/da40-normals.mjs';

const requireTools = createRequire(new URL('../tools/da40-tooling/package.json', import.meta.url));
const { Document } = requireTools('@gltf-transform/core');
const ac = `OBJECT poly
name "fuselage"
crease 40.0
numvert 8
0 0 0
1 0 0
0 1 0
0 0.86603 0.5
0 0 1
0 0.96593 0.25882
0 0 0
1 0 0
numsurf 4
SURF 0X10
mat 0
refs 3
0 0 0
1 1 0
2 0 1
SURF 0X10
mat 0
refs 3
6 0 0
7 1 0
3 0 1
SURF 0X10
mat 0
refs 3
0 0 0
1 1 0
4 0 1
SURF 0X0
mat 0
refs 3
0 0 0
1 1 0
5 0 1
kids 0
`;
const document = new Document();
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0.86603, 0.5, 0, 0, 1, 0, 0.96593, 0.25882, 0, 0, 0, 1, 0, 0]);
const primitive = document.createPrimitive()
  .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions))
  .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 6, 7, 3, 0, 1, 4, 0, 1, 5])));
const node = document.createNode('fuselage').setMesh(document.createMesh().addPrimitive(primitive));
assert.equal(restoreAirframeNormals(document, node, airframeSurfaces(ac)), 4);
const indices = primitive.getIndices().getArray(), normals = primitive.getAttribute('NORMAL');
const corner = (triangle) => normals.getElement(indices[triangle * 3], []);
const close = (first, second) => Math.hypot(...first.map((value, axis) => value - second[axis])) < 0.0001;
assert(close(corner(0), corner(1)), 'smooth faces share a normal across UV-split vertices');
assert(!close(corner(0), corner(2)), 'the original 40-degree crease remains sharp');
assert(close(corner(3), [0, -0.25882, 0.96593]), 'a source flat face stays flat even below the crease angle');
assert.equal(indices.length, 12, 'source triangles are retained');
console.log('DA40 normals: source smoothing, crease and flat-face rules pass.');
