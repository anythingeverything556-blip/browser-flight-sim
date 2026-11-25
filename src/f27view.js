import { Vector3 } from 'three';

// F27 ONLY. No renderer sizing, persistent extra scene pass, or lighting changes.
// Asset preparation runs with the old view active. Activation happens at the top
// of a normal frame, not inside a promise callback midway through frame setup.
export function createF27ViewTransition({ getView, prepare, apply, cover = () => {}, timeoutMs = 15000 }) {
  let serial = 0, pending = null, covered = false, displayed = getView();
  const settle = (job, status, error) => {
    clearTimeout(job.timer);
    job.resolve({ status, view: job.view, ...(error ? { error } : {}) });
  };
  const failed = (job, error) => {
    pending = covered ? { id: serial, view: displayed, phase: 'ready', prepared: false, resolve() {} } : null;
    settle(job, 'failed', error);
  };
  return {
    get pending() { return pending?.view ?? null; },
    get active() { return pending?.phase === 'frame'; },
    request(view) {
      const id = ++serial;
      if (pending) settle(pending, 'superseded');
      const promise = new Promise(resolve => {
        const job = pending = { id, view, resolve, phase: 'loading', prepared: false };
        // Even selecting the current view after cancelling another request must
        // go through one fresh frame if a covered target was already activated.
        job.timer = setTimeout(() => {
          if (pending !== job || job.phase !== 'loading') return;
          failed(job, new Error('F27 view assets timed out; last displayed view retained.'));
        }, timeoutMs);
        Promise.resolve().then(() => prepare(view)).then(() => {
          if (pending !== job || serial !== id) return;
          clearTimeout(job.timer); job.phase = 'ready';
        }, error => {
          if (pending !== job) return;
          failed(job, error);
        });
      });
      return promise;
    },
    beginFrame() {
      if (pending?.phase === 'frame') pending.prepared = false;
      if (pending?.phase !== 'ready') return false;
      const job = pending;
      cover(true); covered = true; // fail closed if a frame/pipeline later throws or is skipped
      job.phase = 'frame'; job.from = getView();
      try { apply(job.view); } catch (error) {
        // Keep covered: caller may request the source again for safe recovery.
        failed(job, error); throw error;
      }
      return true;
    },
    // Before env.update: bypass only its refresh throttles, never fake noon or
    // change sun/pooled-light intensities during shader compilation.
    beforeEnvironment(env) {
      if (pending?.phase !== 'frame') return false;
      env.lutAt = -Infinity; env.envAt = -Infinity;
      return true;
    },
    // Call only on a drawable frame after target camera + env + scenery + visual
    // + pooled-light updates; before cloud-shadow/cascade updates.
    prepareFrame(context) {
      if (pending?.phase !== 'frame') return false;
      prepareF27ViewFrame(context); pending.prepared = true;
      return true;
    },
    // Call AFTER main's cadence block (it overwrites renderer.needsUpdate).
    beforeRender(renderer) {
      if (pending?.phase === 'frame' && pending.prepared) renderer.shadowMap.needsUpdate = true;
    },
    // Only after post.render actually returns, never on a draw=false frame.
    afterRender(renderer) {
      if (pending?.phase !== 'frame' || !pending.prepared || renderer.getContext().isContextLost()) return false;
      const job = pending; pending = null;
      displayed = job.view; cover(false); covered = false; settle(job, 'shown'); return true;
    },
  };
}

// Neutral opaque cover is only observable on skipped/failed draw frames. It is
// removed in the same JS task as a successful target render, before browser paint.
export function createF27ViewCover(canvas) {
  const el = canvas.ownerDocument.createElement('div');
  el.setAttribute('role', 'status'); el.textContent = 'Preparing F27 view…';
  Object.assign(el.style, { position: 'fixed', inset: '0', zIndex: '40', background: '#101820', color: '#fff',
    display: 'none', placeItems: 'center', font: '16px system-ui', pointerEvents: 'none' });
  canvas.parentElement.append(el);
  return { set(active) { el.style.display = active ? 'grid' : 'none'; }, dispose() { el.remove(); } };
}

// The VC GLB overlaps the exterior, so do NOT reveal both to keep a sun caster.
// Opaque cockpit geometry casts its OWN self map when that representation is
// active. Preserve authored/default node visibility and transparent prop/glass.
export function prepareF27ViewCasters(part) {
  if (part?.kind !== 'cockpit') return 0;
  let count = 0;
  const extent=new Vector3(), scale=new Vector3();
  part.root.updateMatrixWorld(true);
  part.root.traverse(o => {
    if (o.userData.f27StaticBatch) return; // retain source caster classification after merging
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!o.isMesh || !mats.length || !mats.every(m => m && !m.transparent && m.visible !== false)) return;
    // Use the shell, pillars, consoles and other large structures for the sun
    // map. Rendering a second copy of every screw, needle and switch added
    // >1,000 shadow submissions to the cockpit and undid the response fix.
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const {x,y,z}=o.geometry.boundingBox.getSize(extent).multiply(o.getWorldScale(scale));
    const [a,b]=[Math.abs(x),Math.abs(y),Math.abs(z)].sort((a,b)=>b-a);
    if(a<0.25||a*b<0.08)return;
    o.castShadow = true; count++;
  });
  return count;
}

export function prepareF27ViewFrame({ renderer, scene, shadows, cloudShadow, vclouds, post, shAt, aoTarget = 0 }) {
  // Scene matrices must match camera-relative placement and animated light
  // anchors BEFORE rendering shadows. Nothing here changes light intensity.
  scene.updateMatrixWorld(true);
  if (shadows?.fresh) shadows.fresh.fill(false); // all configured cascades, once
  if (shAt) shAt.v = null; // integrate with main's self-shadow dirty signature
  renderer.shadowMap.needsUpdate = true;
  if (cloudShadow) {
    cloudShadow.map.w = 0; cloudShadow.map2.w = 0;
    cloudShadow.old.valid = false; cloudShadow.mix = 1;
  }
  // A first target frame must march, not reproject the old view/depth/lighting.
  if (vclouds) vclouds._marchedAt = null;
  // AO is current-depth, not temporal; the old scalar is what caused settling.
  if (post?.enabled) post.aoStrength = aoTarget;
  return aoTarget; // assign aoNow too, so main's easing cannot undo the snap
}
