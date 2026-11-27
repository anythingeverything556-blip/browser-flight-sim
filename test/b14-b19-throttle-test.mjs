// Real desktop pointer/keyboard and Chromium AX semantics, using shipped throttle markup/handlers.
// Renderer-free/offline: no flight, aircraft assets, or weather requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const main = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = main.indexOf('const lever = '), end = main.indexOf('// loading-screen tips', start);
assert.ok(start >= 0 && end > start, 'locate real throttle code');
const code = main.slice(start, end);
const markup = html.slice(html.indexOf('  <div id="throttle-lever"'), html.indexOf('  <aside id="guide"'));
assert.ok(markup.includes('id="tl-track"'), 'locate shipped slider');
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  async function mount({ga = false, heavy = false} = {}) {
    await page.setContent(`<style>#tl-track {position:relative;width:60px;height:200px;touch-action:none} #throttle-lever {margin:40px} .tl-knob {position:absolute}</style><div id="strip"><div class="seg-d thr"><div class="bars"></div></div></div><div><span id="d-tr"></span></div>${markup}`);
    await page.evaluate(({code, ga, heavy}) => {
      window.controls = {enabled: true, locked: false, throttle: 0, touched: false}; window.fdm = {throttle: 0};
      window.update = Function('controls', 'fdm', 'state', 'ap', '$', 'IS_GA', 'IS_HEAVY', 'IS_F27', `${code}; return updateLever;`)(controls, fdm, {started:true,pending:false}, {on:false}, id => document.getElementById(id), ga, heavy, false);
      window.sync = () => {fdm.throttle = controls.throttle; update();}; sync();
    }, {code, ga, heavy});
  }
  const value = () => page.evaluate(() => controls.throttle), sync = () => page.evaluate(() => sync());
  const ax = await page.createCDPSession(); await ax.send('Accessibility.enable');
  async function sliderAX() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const {nodes} = await ax.send('Accessibility.getFullAXTree');
    const slider = nodes.find(n => n.role?.value === 'slider');
    assert.ok(slider, 'slider exposed in accessibility tree'); assert.equal(slider.name?.value, 'Throttle lever'); return slider;
  }
  const property = (node, name) => node.properties.find(p => p.name === name)?.value.value;
  await mount(); let slider = await sliderAX();
  assert.equal(slider.value?.value, 0); assert.equal(await page.$eval('#tl-track',e=>e.getAttribute('aria-valuetext')), '0% throttle, idle'); assert.equal(property(slider, 'orientation'), 'vertical');
  const rect = await page.$eval('#tl-track', el => {const r=el.getBoundingClientRect();return {x:r.x+r.width/2,top:r.top,bottom:r.bottom};});
  async function clickAt(t) {await page.mouse.click(rect.x, rect.bottom-t*(rect.bottom-rect.top));await sync();}
  // Both lock reasons refuse mutation before display synchronization, without marking input touched.
  for (const reason of ['locked', 'disabled']) {
    await page.evaluate(reason => {controls.throttle=.4;controls.touched=false;controls.locked=reason==='locked';controls.enabled=reason!=='disabled';}, reason);
    await clickAt(.9); await page.focus('#tl-track');
    for (const key of ['ArrowUp','ArrowDown','Home','End']) await page.keyboard.press(key);
    assert.deepEqual(await page.evaluate(() => [controls.throttle,controls.touched]), [.4,false], `${reason}: cannot queue power for resume`);
    assert.equal(await page.$eval('#tl-track',e=>e.getAttribute('aria-disabled')), 'true');
    assert.equal(property(await sliderAX(), 'disabled'), true);
    await page.evaluate(() => {controls.enabled=true;controls.locked=false;sync();});
    assert.equal(await value(), .4, 'unlock leaves demand unchanged');
    assert.equal(await page.$eval('#tl-track',e=>e.getAttribute('aria-disabled')), 'false', 'disabled semantics refresh at unchanged value');
  }
  await clickAt(.5);assert.equal(await value(),.5,'unlocked pointer changes throttle'); await page.focus('#tl-track');
  await page.keyboard.press('ArrowUp');assert.equal(await value(),.55);
  await page.keyboard.press('ArrowDown');assert.equal(await value(),.5);
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');assert.equal(await value(),0,'clamps at idle');
  await page.keyboard.press('End');await page.keyboard.press('ArrowUp');assert.equal(await value(),1,'clamps at full power');
  // Locking/disabling during capture must work before the next display sync too.
  for (const reason of ['locked','disabled']) {
    await page.mouse.move(rect.x,rect.bottom-100);await page.mouse.down();const held=await value();
    await page.evaluate(reason => {controls.locked=reason==='locked';controls.enabled=reason!=='disabled';},reason);
    await page.mouse.move(rect.x,rect.top+10);assert.equal(await value(),held,'mid-drag input gate is immediate');
    await page.evaluate(() => {controls.locked=false;controls.enabled=true;sync();});
    await page.mouse.move(rect.x,rect.top+30);assert.equal(await value(),held,'drag cannot resume across unlock');
    await page.mouse.up();await clickAt(.25);assert.equal(await value(),.25,'fresh unlocked drag works');
  }
  // A frame observing the lock must also cancel an unmoved drag before resume.
  await page.mouse.move(rect.x,rect.bottom-100);await page.mouse.down();const held=await value();
  await page.evaluate(() => {controls.locked=true;sync();controls.locked=false;sync();});
  await page.mouse.move(rect.x,rect.top+30);assert.equal(await value(),held,'display sync cancels an unmoved drag');await page.mouse.up();
  for (const type of ['pointercancel','lostpointercapture']) {
    await page.mouse.move(rect.x,rect.bottom-100);await page.mouse.down();
    await page.$eval('#tl-track',(el,type)=>el.dispatchEvent(new PointerEvent(type,{pointerId:1})),type);
    const cancelled=await value();await page.mouse.move(rect.x,rect.top+10);assert.equal(await value(),cancelled,`${type} clears drag`);await page.mouse.up();
  }
  for (const [flags,t,spoken] of [
    [{},0,'0% throttle, idle'], [{},.376,'38% throttle, 50% military power'],
    [{},.75,'75% throttle, 100% military power'], [{},.876,'88% throttle, afterburner 50%'],
    [{ga:true},.6,'60% throttle'], [{heavy:true},.8,'80% throttle'],
  ]) {
    await mount(flags);await page.evaluate(t=>{controls.throttle=t;sync();},t);slider=await sliderAX();
    assert.equal(slider.value.value,Math.round(t*100),'AX numeric value uses full 0–100 scale');
    // This Chromium build omits valuetext in CDP, so verify its DOM semantics directly.
    assert.equal(await page.$eval('#tl-track',e=>e.getAttribute('aria-valuetext')),spoken,'spoken value agrees with numeric scale/aircraft regime');
  }
  assert.deepEqual(errors,[],'no uncaught throttle errors');
  console.log('PASS B14/B19: locked/disabled pointer and keyboard, resume demand, drag cancellation, accessible slider name/state/value for jet/GA/heavy');
} finally {await browser.close();}
