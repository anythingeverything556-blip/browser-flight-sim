import { build } from 'vite';
import { cp, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// A private local test build for small aircraft. The optional multi-GB A380
// release lives in a separate build; never mutate it or guard it with symlinks.
const out = resolve('.scratch/da40/dist');
const src = resolve('public');
const skip = resolve(src, 'models/a380x');
await build({build:{outDir:out,emptyOutDir:true,copyPublicDir:false}});
for (const name of await readdir(src)) {
  await cp(resolve(src,name),resolve(out,name),{
    recursive:true,
    filter: p => p!==skip && !p.startsWith(skip+sep),
  });
}
const aircraftPath=resolve(out, 'models/da40/da40-ng.glb');
const bytes=(await stat(aircraftPath)).size;
if (!bytes) throw new Error('Missing DA40 asset in build');
console.log(`Local DA40 build ready: ${bytes} model bytes. Existing production build unchanged.`);
