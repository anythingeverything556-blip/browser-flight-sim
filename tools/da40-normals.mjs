const AIRFRAME = new Set(['fuselage', 'wings', 'hstab', 'canopy.F', 'door.R', 'spinner',
  'wheelfairingF', 'wheelfairingL', 'wheelfairingR', 'window.F', 'window.L', 'window.R',
  'aileron.L', 'aileron.R', 'flap.L', 'flap.R', 'elevator', 'elevator.trim.tab', 'rudder']);

const key = (point) => point.map((value) => Math.round(value * 100000)).join(',');
const dot = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
function normal(points) {
  const origin = points[0];
  for (let index = 1; index + 1 < points.length; index++) {
    const first = points[index].map((value, axis) => value - origin[axis]);
    const second = points[index + 1].map((value, axis) => value - origin[axis]);
    const result = [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]];
    const length = Math.hypot(...result);
    if (length > 1e-12) return result.map((value) => value / length);
  }
  return null;
}

export function airframeSurfaces(ac) {
  const result = new Map();
  for (const chunk of ac.split(/^OBJECT /m).slice(1)) {
    const name = /^name "([^"]+)"/m.exec(chunk)?.[1];
    if (!AIRFRAME.has(name)) continue;
    const lines = chunk.split(/\r?\n/);
    const vertexLine = lines.findIndex((line) => /^numvert\s/.test(line));
    const vertexCount = Number(lines[vertexLine].split(/\s+/)[1]);
    const vertices = lines.slice(vertexLine + 1, vertexLine + 1 + vertexCount).map((line) => {
      return line.trim().split(/\s+/).map(Number);
    });
    const crease = Number(/^crease\s+([^\s]+)/m.exec(chunk)?.[1] || 45);
    const byPosition = new Map();
    for (let index = vertexLine + 1 + vertexCount; index < lines.length; index++) {
      if (!/^SURF\s/i.test(lines[index])) continue;
      const smooth = (parseInt(lines[index].trim().split(/\s+/)[1], 16) & 0x10) !== 0;
      while (index < lines.length && !/^refs\s/.test(lines[index])) index++;
      const count = Number(lines[index].trim().split(/\s+/)[1]);
      const indices = lines.slice(index + 1, index + 1 + count).map((line) => Number(line.trim().split(/\s+/)[0]));
      index += count;
      const faceNormal = normal(indices.map((vertex) => vertices[vertex]));
      if (!faceNormal) continue;
      const face = { indices, smooth, normal: faceNormal };
      for (const vertex of indices) {
        const position = key(vertices[vertex]);
        if (!byPosition.has(position)) byPosition.set(position, new Set());
        byPosition.get(position).add(face);
      }
    }
    result.set(name, { vertices, byPosition, crease: Math.cos(crease * Math.PI / 180) });
  }
  return result;
}

export function restoreAirframeNormals(document, node, source) {
  const mesh = node.getMesh(), surface = source.get(node.getName());
  if (!mesh || !surface) return 0;
  let triangleCount = 0;
  for (const primitive of mesh.listPrimitives()) {
    if (primitive.getAttribute('NORMAL')) continue;
    const indices = primitive.getIndices()?.getArray(), position = primitive.getAttribute('POSITION');
    if (!indices || !position || indices.length % 3) throw new Error(`Unsupported ${node.getName()} topology`);
    const attributes = primitive.listSemantics().map((semantic) => ({ semantic, accessor: primitive.getAttribute(semantic), values: [] }));
    const normals = [], newIndices = [], remap = new Map();
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const points = [0, 1, 2].map((corner) => position.getElement(indices[triangle + corner], []));
      const faceNormal = normal(points);
      const positions = points.map(key);
      const candidates = [...(surface.byPosition.get(positions[0]) || [])].filter((face) =>
        surface.byPosition.get(positions[1])?.has(face) && surface.byPosition.get(positions[2])?.has(face));
      if (!faceNormal) {
        for (let corner = 0; corner < 3; corner++) {
          newIndices.push(remap.size); remap.set(`degenerate:${triangle}:${corner}`, remap.size); normals.push(0, 1, 0);
          for (const attribute of attributes) attribute.values.push(...attribute.accessor.getElement(indices[triangle + corner], []));
        }
        triangleCount++;
        continue;
      }
      const face = candidates.sort((first, second) => Math.abs(dot(second.normal, faceNormal)) - Math.abs(dot(first.normal, faceNormal)))[0];
      if (!face) throw new Error(`Cannot match ${node.getName()} triangle ${triangle / 3} to the original AC surface: ${JSON.stringify(points)} (${candidates.length} candidates)`);
      const direction = Math.sign(dot(face.normal, faceNormal));
      for (let corner = 0; corner < 3; corner++) {
        const vertex = face.indices.find((index) => key(surface.vertices[index]) === positions[corner]);
        if (vertex === undefined) throw new Error(`Missing original ${node.getName()} vertex`);
        let shaded = face.normal;
        if (face.smooth) {
          const neighbours = [...surface.byPosition.get(positions[corner])].filter((other) => other.smooth && dot(face.normal, other.normal) >= surface.crease);
          const sum = neighbours.reduce((total, other) => total.map((value, axis) => value + other.normal[axis]), [0, 0, 0]);
          const length = Math.hypot(...sum);
          if (length > 1e-12) shaded = sum.map((value) => value / length);
        }
        shaded = shaded.map((value) => value * direction);
        const oldIndex = indices[triangle + corner], signature = `${oldIndex}:${shaded.map((value) => value.toFixed(6)).join(',')}`;
        let newIndex = remap.get(signature);
        if (newIndex === undefined) {
          newIndex = remap.size; remap.set(signature, newIndex); normals.push(...shaded);
          for (const attribute of attributes) attribute.values.push(...attribute.accessor.getElement(oldIndex, []));
        }
        newIndices.push(newIndex);
      }
      triangleCount++;
    }
    for (const attribute of attributes) {
      const array = attribute.accessor.getArray();
      primitive.setAttribute(attribute.semantic, document.createAccessor().setType(attribute.accessor.getType()).setArray(new array.constructor(attribute.values)));
    }
    primitive.setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(new Float32Array(normals)));
    primitive.setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(newIndices)));
  }
  return triangleCount;
}
