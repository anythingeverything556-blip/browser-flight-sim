// EW-35: reuse the real built-app smoke with the optional Gamepad API denied.
// Run after npm run build; SMOKE_OUTPUT_DIR selects the local evidence folder.
import puppeteer from 'puppeteer-core';
const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async options => {
  const browser = await launch(options), newPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await newPage();
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'getGamepads', {
      value() { throw new DOMException('Synthetic gamepad policy denial', 'SecurityError'); },
    }));
    return page;
  };
  return browser;
};
await import('../tools/browser-smoke.mjs');
