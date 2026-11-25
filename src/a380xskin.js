import { Uint16BufferAttribute } from 'three';

// The original compiled MSFS cockpit includes eight one-based blend palettes.
// Decode only an unambiguous 1..boneCount palette. Keep the source buffer, all
// positions, indices, weights and skeleton bones intact; never mask bad skins.
export function decodeA380SkinPalettes(root) {
  let decoded = 0;
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
    const count = mesh.skeleton.bones.length;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < joints.count; i++) for (let c = 0; c < 4; c++) {
      if (weights.getComponent(i, c) === 0) continue;
      const value = joints.getComponent(i, c); min = Math.min(min, value); max = Math.max(max, value);
    }
    if (max < count && min >= 0) return;
    if (min !== 1 || max !== count) throw new Error(`Unsupported original A380 skin palette: ${mesh.name} (${min}..${max}, ${count} bones)`);
    const values = new Uint16Array(joints.count * 4);
    for (let i = 0; i < joints.count; i++) for (let c = 0; c < 4; c++) {
      const value = joints.getComponent(i, c);
      if (weights.getComponent(i, c) !== 0 && (value < 1 || value > count)) throw new Error(`Invalid original A380 joint: ${mesh.name}`);
      values[i * 4 + c] = value > 0 ? value - 1 : 0;
    }
    // A geometry may be shared by distinct skins: only this draw gets its
    // decoded palette, with every other attribute copied unchanged.
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.setAttribute('skinIndex', new Uint16BufferAttribute(values, 4));
    mesh.userData.a380PaletteEncoding = 'source-one-based'; decoded++;
  });
  return decoded;
}
