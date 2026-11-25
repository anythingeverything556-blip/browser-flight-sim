import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const output = process.env.INTRO_SCREENSHOTS || '.scratch/da40/ui-polish';
await mkdir(output, { recursive: true });
const main = await readFile('src/main.js', 'utf8');
const placement = main.slice(main.indexOf('const acPick = '), main.indexOf('// aircraft picker:'));
assert.match(placement, /function placeAircraftPicker/);
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const origin = server.resolvedUrls.local[0];
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-webgl', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('request', request => new URL(request.url()).origin === new URL(origin).origin || request.url().startsWith('data:') ? request.continue() : request.abort());
  await page.setViewport({ width: 1200, height: 575 });
  await page.goto(origin, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body.startup-failed');
  assert.equal(await page.$eval('#ac-cards [aria-checked=true]', element => element.dataset.v), 'da40');
  await page.evaluate(source => {
    document.body.classList.remove('startup-failed');
    document.body.classList.add('ready');
    document.querySelectorAll('#sheet-flight button, #sheet-flight input, #sheet-flight select').forEach(element => { element.disabled = false; });
    Function('const $ = id => document.getElementById(id); ' + source)();
  }, placement);

  const viewports = [[1920, 1080], [1440, 900], [1200, 640], [1200, 575], [1180, 640], [1179, 640], [844, 390], [768, 1024], [760, 1024], [568, 320], [390, 844], [320, 568]];
  for (const [width, height] of viewports) {
    await page.setViewport({ width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(() => {
      const rect = selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const pick = document.querySelector('#ac-pick');
      const cards = [...pick.querySelectorAll('.ac-card')];
      return {
        hero: rect('#hero'), heading: rect('#hero h1'), nav: rect('#hero nav'), panel: rect('#sheet-flight'),
        body: rect('#sheet-flight .body'), footer: rect('#sheet-flight .sheet-foot'), start: rect('#start-btn'),
        picker: rect('#ac-pick'), pickerLabel: rect('#ac-pick > .lbl'), cards: cards.map(card => {
          const box = card.getBoundingClientRect();
          const name = card.querySelector('.ac-name b');
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, nameClipped: name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 1 };
        }),
        wide: pick.parentElement.id === 'hero-ac',
        caption: rect('#hero .hero-caption'),
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    const tag = `${width}x${height}`;
    assert.equal(result.wide, width >= 1180 && height >= 640, `${tag}: picker placement`);
    assert.ok(result.heading.left >= 0 && result.heading.right <= width, `${tag}: heading in viewport`);
    assert.ok(result.panel.left >= 0 && result.panel.right <= width && result.panel.top >= 0 && result.panel.bottom <= height, `${tag}: setup panel in viewport`);
    assert.ok(result.body.height >= 40, `${tag}: scrollable setup body has space (${result.body.height})`);
    assert.ok(result.start.top >= result.footer.top && result.start.bottom <= result.footer.bottom && result.start.bottom <= height, `${tag}: Start flight visible`);
    assert.ok(result.footer.top >= result.body.bottom - 1, `${tag}: footer below scroll area`);
    assert.ok(result.documentWidth <= width, `${tag}: no horizontal document overflow`);
    if (width <= 760) assert.ok(result.nav.bottom <= result.panel.top, `${tag}: mobile hero clears setup panel`);
    else assert.ok(result.hero.right <= result.panel.left, `${tag}: hero clears setup panel`);
    if (result.wide) {
      assert.ok(result.caption.bottom + 4 <= result.pickerLabel.top, `${tag}: film caption clears picker`);
      assert.ok(result.picker.right <= result.panel.left, `${tag}: picker clears panel`);
      assert.ok(result.cards.every(card => Math.abs(card.top - result.cards[0].top) < 1), `${tag}: five cards share one row`);
      assert.ok(result.cards.every(card => !card.nameClipped), `${tag}: full card names visible`);
    }
    await page.screenshot({ path: `${output}/${tag}.png` });
  }

  await page.setViewport({ width: 1200, height: 640 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.focus('#ac-cards [data-v="da40"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), 'sr71');
  assert.equal(await page.$eval('#ac-cards [aria-checked=true]', element => element.dataset.v), 'sr71');
  assert.equal(await page.$$eval('#ac-cards [tabindex="0"]', elements => elements.length), 1);
  assert.equal(await page.$$eval('#ac-cards [data-v="a380x"]', elements => elements.length), 0);
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), 'da40');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), 'il76');
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), 'il76', 'focus survives moving the picker across the breakpoint');
  await page.focus('#ac-cards [data-v="da40"]');
  assert.equal(await page.evaluate(() => {
    const target = document.activeElement.getBoundingClientRect();
    const body = document.querySelector('#sheet-flight .body').getBoundingClientRect();
    return target.top >= body.top && target.bottom <= body.bottom;
  }), true, 'mobile aircraft selection scrolls into view when focused');
  await page.setViewport({ width: 1200, height: 640 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), 'da40', 'focus survives moving the picker back to the hero');
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.click('.hero-terms');
  assert.equal(await page.$eval('#terms', element => element.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.matches('.hero-terms')), true);

  await page.evaluateOnNewDocument(() => localStorage.setItem('sr71sim.settings', JSON.stringify({ aircraft: 'c172' })));
  await page.goto(`${origin}?aircraft=sf50`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body.startup-failed');
  assert.equal(await page.$eval('#ac-cards [aria-checked=true]', element => element.dataset.v), 'sf50', 'explicit choice overrides saved choice');
  await page.goto(origin, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body.startup-failed');
  assert.equal(await page.$eval('#ac-cards [aria-checked=true]', element => element.dataset.v), 'c172', 'saved choice survives');
  console.log(`PASS intro layout, selection and keyboard checks: ${viewports.map(([width, height]) => `${width}x${height}`).join(', ')}`);
} finally {
  if (browser) await browser.close();
  await server.close();
}
