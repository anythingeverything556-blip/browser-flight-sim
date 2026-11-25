import './flight-hud.css';

// Subtract opaque HUD obstacles, retaining every usable rectangular region.
// Pure geometry is shared with regression tests; no aircraft/physics dependencies.
export function freeHudRects(bounds, obstacles, gap = 12) {
  let spaces = [bounds];
  for (const box of obstacles) {
    const b = {left: box.left-gap, right: box.right+gap, top: box.top-gap, bottom: box.bottom+gap};
    spaces = spaces.flatMap(a => {
      if (b.left >= a.right || b.right <= a.left || b.top >= a.bottom || b.bottom <= a.top) return [a];
      return [
        {...a, right: Math.min(a.right, b.left)}, {...a, left: Math.max(a.left, b.right)},
        {...a, bottom: Math.min(a.bottom, b.top)}, {...a, top: Math.max(a.top, b.bottom)},
      ].filter(r => r.right-r.left >= 44 && r.bottom-r.top >= 32);
    });
  }
  return spaces;
}

export function chooseRadioRect(bounds, obstacles, desiredHeight) {
  const spaces = freeHudRects(bounds, obstacles);
  // Prefer a complete message stack, then a readable width, then the usual lower-left corner.
  const candidates = spaces.map(r => {
    const width = Math.min(430, r.right-r.left), height = Math.min(desiredHeight, r.bottom-r.top);
    const score = Math.min(1, width/260)*Math.min(1, height/desiredHeight)*10000 + width + r.bottom/100 - r.left/100;
    return {...r, width, height, score};
  }).sort((a,b) => b.score-a.score);
  return candidates[0] || {...bounds, width: bounds.right-bounds.left, height: Math.max(32, bounds.bottom-bounds.top)};
}

export function mountFlightHud(doc = document, win = window) {
  const root=doc.documentElement, radio=doc.getElementById('radio'), strip=doc.getElementById('strip');
  if (!radio || !strip) return null;
  let frame=0, destroyed=false;
  const px=(name,value) => {const next=Math.round(value*100)/100+'px';if(root.style.getPropertyValue(name)!==next)root.style.setProperty(name,next);};
  const visible=e=>e && e.getClientRects().length && win.getComputedStyle(e).display!=='none';
  const rect=e=>visible(e)?e.getBoundingClientRect():null;
  const watched=new Set();
  const resize=win.ResizeObserver?new win.ResizeObserver(()=>schedule()):null;
  function watch() {
    for (const e of doc.querySelectorAll('#rail,#strip,#status,#radio,#coach,#guide,#mission,#imagery-notice,#throttle-lever,.tl-hint,.cockpitmap,#touch-controls,.sheet')) {
      if (!watched.has(e)) {watched.add(e);resize?.observe(e);}
    }
  }
  function sync() {
    frame=0;if(destroyed)return;
    watch();
    const styles=win.getComputedStyle(root), edge=parseFloat(win.getComputedStyle(strip).bottom) || 16;
    const railElement=doc.getElementById('rail');
    if(railElement)railElement.toggleAttribute('data-scroll',railElement.scrollHeight>railElement.clientHeight+1);
    const stripBox=rect(strip), status=rect(doc.getElementById('status')), rail=rect(doc.getElementById('rail'));
    const floor=stripBox?win.innerHeight-stripBox.top:edge;
    px('--strip-h',stripBox?.height||0);px('--hud-floor',floor);
    px('--hud-status-bottom',status?.bottom||edge);
    px('--hud-lever-top',rect(doc.getElementById('throttle-lever'))?.top||0);
    // Read again after the shared floor moves map/touch/guide and the throttle.
    const left=Math.max(rail?rail.right+12:edge,parseFloat(styles.getPropertyValue('--sheet-left'))||0);
    const right=win.innerWidth-(parseFloat(win.getComputedStyle(doc.getElementById('status')).right)||edge);
    const bounds={left,right,top:(status?.bottom||edge)+12,bottom:win.innerHeight-floor-12};
    const obstacles=[...doc.querySelectorAll('.cockpitmap,#coach,#guide,#mission,#imagery-notice,#throttle-lever,.tl-hint,#touch-controls,.sheet.open')].filter(visible).map(e=>e.getBoundingClientRect());
    // Touch hints are positioned above the landscape control row.
    const hint=rect(doc.querySelector('#touch-controls .touch-hint'));if(hint)obstacles.push(hint);
    const desired=Math.max(44,radio.scrollHeight);
    const placement=chooseRadioRect(bounds,obstacles,desired);
    px('--radio-left',placement.left);px('--radio-width',placement.width);
    px('--radio-bottom',win.innerHeight-placement.bottom);px('--radio-height',placement.height);
    // Short viewports retain a keyboard- and pointer-scrollable live log.
    const scrollable=radio.scrollHeight>radio.clientHeight+1;
    if(scrollable){radio.tabIndex=0;radio.setAttribute('aria-label','Radio messages; scroll to read earlier calls');}
    else {radio.removeAttribute('tabindex');radio.removeAttribute('aria-label');}
  }
  function schedule(){if(!frame&&!destroyed)frame=win.requestAnimationFrame(sync);}
  const mutations=new win.MutationObserver(records=>{
    if(records.some(r=>r.type==='attributes'&&(r.target===doc.body||watched.has(r.target))||
      r.type==='childList'&&(r.target===doc.body||r.target===radio)))schedule();
  });
  mutations.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
  win.addEventListener('resize',schedule);win.visualViewport?.addEventListener('resize',schedule);
  watch();schedule();
  return {sync:schedule,destroy(){destroyed=true;win.cancelAnimationFrame(frame);resize?.disconnect();mutations.disconnect();win.removeEventListener('resize',schedule);win.visualViewport?.removeEventListener('resize',schedule);}};
}
