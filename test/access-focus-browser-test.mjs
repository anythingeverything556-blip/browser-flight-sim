// Renderer-free, offline Chromium coverage using the shipped DOM/CSS, native
// events, production controllers and main.js's actual localized UI handlers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const main = await fs.readFile('src/main.js', 'utf8');
const slice = (start, end) => {
  assert.ok(main.includes(start) && main.includes(end), `source boundaries: ${start}`);
  return main.slice(main.indexOf(start), main.indexOf(end));
};
const code = `
import { Controls } from './src/controls.js';
import { createSheetController } from './src/sheet-controller.js';
import { createTeleportDialog } from './src/teleport-dialog.js';
import { returnFocusAfterPointer } from './src/cockpit-focus.js';
const $ = id => document.getElementById(id);
const controls = new Controls(), state = { started: true, paused: false, graphicsHold: false };
const audio = { enabled: true }, atc = { soundChanged() {} }, fdm = { crashed: false };
function holdAudio() {}
const mapPanel = { shown() {} }; function renderAptList() {} function renderHome() {}
${slice('// ---------- sheets ----------', '// dock labels are tooltips')}
${slice('function pause(v)', "$('crash-reset').addEventListener")}
${main.match(/controls.on\('pause', [^\n]+/)[0]}
${main.match(/controls.on\('sound', [^\n]+/)[0]}
${main.match(/const teleportDialog = [^\n]+/)[0]}
${slice('function closeTeleport()', "$('tp-form').addEventListener")}
$('tp-form').addEventListener('submit', event => { event.preventDefault(); closeTeleport(); openSheet(null); });
window.fixture = { controls, state, audio, openSheet, teleportDialog };
`;
const bundle = await build({ stdin: { contents: code, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', logLevel: 'error' });
const html = (await fs.readFile('index.html', 'utf8')).replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
const css = await fs.readFile('src/style.css', 'utf8');
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-webgl'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true); page.on('request', r => r.abort());
  await page.setViewport({ width: 1280, height: 800 });
  await page.setContent(html); await page.addStyleTag({ content: css });
  await page.evaluate(() => document.body.classList.remove('intro'));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const pressed = id => page.$eval('#' + id, e => e.getAttribute('aria-pressed'));
  const focus = () => page.evaluate(() => document.activeElement.id);
  const key = async value => {
    if (value === 'Shift+Tab') { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); }
    else await page.keyboard.press(value);
  };

  assert.equal(await pressed('b-pause'), 'false');
  assert.equal(await pressed('b-sound'), 'true');
  await page.click('#b-pause'); assert.equal(await pressed('b-pause'), 'true');
  assert.notEqual(await focus(), 'b-pause');
  await key('p'); assert.equal(await pressed('b-pause'), 'false', 'P works immediately after pointer Pause');
  await page.click('#b-sound'); assert.equal(await pressed('b-sound'), 'false');
  assert.equal(await page.$eval('#sound-status', e => e.textContent), 'Sound muted');
  await key('o'); assert.equal(await pressed('b-sound'), 'true', 'O works immediately after pointer Sound');
  assert.equal(await page.$eval('#sound-status', e => e.textContent), 'Sound on');
  for (const id of ['b-pause', 'b-sound']) {
    await page.focus('#' + id); const before = await pressed(id); await key('Space');
    assert.equal(await focus(), id, 'keyboard activation keeps native toolbar focus');
    assert.notEqual(await pressed(id), before);
    const after = await pressed(id); await key(id === 'b-pause' ? 'p' : 'o');
    assert.equal(await pressed(id), after, 'focused toolbar is not a flight shortcut target');
    await key('Space');
  }
  console.log('PASS B15/B20 pointer and keyboard Pause/Sound focus, shortcuts, pressed state and mute status');

  for (const id of ['map', 'settings', 'help']) {
    const selector = '#rail [data-sheet="' + id + '"]';
    await page.focus(selector); await key('Enter');
    assert.equal(await page.$eval(selector, b => b.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.$eval(selector, b => b.getAttribute('aria-controls')), 'sheet-' + id);
    assert.equal(await page.$eval(selector, b => b === document.activeElement), true);
    await key('Escape'); assert.equal(await focus(), 'view', 'Escape from rail trigger returns to flight');
    assert.equal(await page.$eval(selector, b => b.getAttribute('aria-expanded')), 'false');
    await key('p'); assert.equal(await pressed('b-pause'), 'true'); await key('p');
  }
  await page.evaluate(() => { fixture.openSheet('settings', true); document.querySelector('#sheet-settings input').focus(); });
  await key('Escape'); assert.equal(await focus(), 'view', 'Escape from editing panel returns to flight');
  await page.evaluate(() => fixture.openSheet('settings', true));
  await page.focus('#vol'); const volume = await page.$eval('#vol', e => e.value);
  await key('ArrowLeft'); assert.notEqual(await page.$eval('#vol', e => e.value), volume, 'native range keyboard editing survives');
  await key('p'); await key('o'); assert.equal(await pressed('b-pause'), 'false'); assert.equal(await pressed('b-sound'), 'true');
  await page.evaluate(() => fixture.openSheet('help', true));
  assert.equal(await page.$eval('#rail [data-sheet=settings]', b => b.getAttribute('aria-expanded')), 'false');
  assert.equal(await page.$eval('#rail [data-sheet=help]', b => b.getAttribute('aria-expanded')), 'true');
  assert.equal(await page.$eval('#rail [data-sheet=help]', b => b === document.activeElement), true, 'panel switch never leaves hidden input focused');
  await page.click('#sheet-help [data-close]'); assert.equal(await focus(), 'view');
  console.log('PASS B15/B20 sheet open/switch/close state, Escape focus recovery and editing isolation');

  await page.evaluate(() => {
    fixture.openSheet('map', true); document.querySelector('#rail [data-sheet=map]').focus();
    document.querySelector('#tp-quick').innerHTML = '<button type="button">Cruise</button><button type="button">Approach</button>';
    fixture.teleportDialog.open();
  });
  assert.equal(await focus(), 'tp-alt');
  assert.equal(await page.evaluate(() => fixture.controls.enabled), false);
  assert.equal(await page.$eval('#tp', e => e.matches(':modal')), true);
  assert.equal(await page.evaluate(() => { document.querySelector('#b-pause').focus(); return document.activeElement.id === 'b-pause'; }), false, 'programmatic focus cannot escape modal');
  for (const direction of ['Tab', 'Shift+Tab']) for (let i = 0; i < 20; i++) {
    await key(direction);
    assert.equal(await page.evaluate(() => document.activeElement === document.body || document.querySelector('#tp').contains(document.activeElement)), true, 'native tab order never reaches background');
  }
  await page.focus('#tp-alt'); await key('p'); await key('o');
  assert.equal(await pressed('b-pause'), 'false'); assert.equal(await pressed('b-sound'), 'true');
  await key('Escape');
  assert.equal(await page.$eval('#tp', e => e.hidden && !e.open), true);
  assert.equal(await page.$eval('#rail [data-sheet=map]', b => b === document.activeElement), true, 'Escape restores opener');
  assert.equal(await page.$eval('#sheet-map', p => p.classList.contains('open')), true, 'modal Escape does not also close underlying sheet');
  assert.equal(await page.evaluate(() => fixture.controls.enabled), true);
  await page.evaluate(() => fixture.teleportDialog.open()); await page.click('#tp-cancel');
  assert.equal(await page.$eval('#rail [data-sheet=map]', b => b === document.activeElement), true, 'Cancel restores opener');
  await page.evaluate(() => fixture.teleportDialog.open()); await page.mouse.click(3, 3);
  assert.equal(await page.$eval('#tp', e => e.hidden && !e.open), true, 'backdrop closes modal');
  assert.equal(await page.$eval('#rail [data-sheet=map]', b => b === document.activeElement), true, 'backdrop restores opener without pointer default stealing focus');
  await page.evaluate(() => { fixture.controls.enabled = false; fixture.teleportDialog.open(); fixture.teleportDialog.close(); });
  assert.equal(await page.evaluate(() => fixture.controls.enabled), false, 'closing never enables previously disabled controls');
  await page.evaluate(() => { fixture.controls.enabled = true; fixture.teleportDialog.open(); fixture.state.started = false; fixture.teleportDialog.close(); });
  assert.equal(await page.evaluate(() => fixture.controls.enabled), false, 'closing before flight never enables flight');
  await page.evaluate(() => { fixture.state.started = true; fixture.controls.enabled = true; });
  for (const [width, height] of [[568, 320], [844, 390]]) {
    await page.setViewport({ width, height });
    await page.evaluate(() => fixture.teleportDialog.open());
    for (const selector of ['#tp-cancel', '#tp-go']) {
      await page.focus(selector);
      assert.equal(await page.$eval(selector, e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true, 'native dialog buttons remain scroll-reachable at ' + width + 'x' + height);
    }
    await page.evaluate(() => fixture.teleportDialog.close());
  }
  await page.evaluate(() => {
    fixture.teleportDialog.open();
    for (const [id, value] of Object.entries({ 'tp-alt': 3000, 'tp-hdg': 90, 'tp-spd': 200, 'tp-gam': 0 })) document.getElementById(id).value = value;
  });
  await page.click('#tp-go'); assert.equal(await focus(), 'view', 'submit closes underlying sheet and returns to flight');
  assert.equal(await page.$eval('#tp', e => e.hidden && !e.open), true);
  assert.equal(await page.evaluate(() => fixture.controls.enabled), true);
  assert.deepEqual(errors, []);
  console.log('PASS B16 native modal trap/inertness, Escape/Cancel/backdrop/submit return, input safety and narrow layout');
} finally { await browser?.close(); }
