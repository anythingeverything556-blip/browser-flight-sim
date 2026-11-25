import assert from 'node:assert/strict';
import fs from 'node:fs';
// The geometry module has no runtime dependency on the stylesheet in Node.
const source=fs.readFileSync('src/flight-hud.js','utf8').replace("import './flight-hud.css';",'');
const {freeHudRects,chooseRadioRect}=await import('data:text/javascript,'+encodeURIComponent(source));
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const placed=r=>({left:r.left,right:r.left+r.width,top:r.bottom-r.height,bottom:r.bottom});
const bounds={left:160,right:1519,top:62,bottom:590};
const map={left:160,right:480,top:258,bottom:578};
const lever={left:1455,right:1519,top:180,bottom:440};
const guide={left:492,right:1052,top:220,bottom:578};
for(const obstacles of [[],[map],[map,lever],[map,lever,guide]]){
 const r=placed(chooseRadioRect(bounds,obstacles,202));
 assert.ok(r.left>=bounds.left&&r.right<=bounds.right&&r.top>=bounds.top&&r.bottom<=bounds.bottom,'all radio bounds remain in flight region');
 for(const box of obstacles)assert.equal(intersects(r,box),false,'radio clears opaque HUD obstacles');
}
const narrow={left:64,right:382,top:54,bottom:650},touch={left:60,right:382,top:400,bottom:650};
const compact=chooseRadioRect(narrow,[touch],380);
assert.ok(compact.width>=200,'narrow calls keep readable line width');
assert.ok(compact.height<380&&compact.height>=100,'crowded log gets a bounded scroll area');
assert.equal(intersects(placed(compact),touch),false);
const short={left:72,right:828,top:62,bottom:170};
assert.ok(chooseRadioRect(short,[],250).height<=108,'short viewports constrain log height rather than clipping it');
assert.deepEqual(freeHudRects(bounds,[]),[bounds]);
assert.deepEqual(freeHudRects(bounds,[{left:0,right:20,top:0,bottom:20}]),[bounds],'outside obstacles do not change placement');
console.log('PASS flight HUD: wide rail reserve, map/guide/lever obstacles, touch log scrolling and short-window bounds');
