import fs from 'node:fs';
import path from 'node:path';

/**
 * Smoke-test the already deployed site (no local server / build required).
 * Usage: node scripts/remote-smoke.mjs [url] [screenshotName]
 */

const url = process.argv[2] ?? 'https://freefoxcm.github.io/mineverse/';
const shotName = process.argv[3] ?? 'deployed-latest.png';
const ROOT = process.cwd();

function findChromium() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CHROMIUM) candidates.push(process.env.PLAYWRIGHT_CHROMIUM);
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const dir = path.join(localAppData, 'ms-playwright');
    if (fs.existsSync(dir)) {
      const versions = fs
        .readdirSync(dir)
        .filter((name) => name.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const version of versions) {
        candidates.push(path.join(dir, version, 'chrome-win64', 'chrome.exe'));
        candidates.push(path.join(dir, version, 'chrome-win', 'chrome.exe'));
      }
    }
  }
  candidates.push(
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  );
  return candidates.find((candidate) => fs.existsSync(candidate));
}

(async () => {
  const { chromium } = await import('playwright-core');
  const executablePath = findChromium();
  if (!executablePath) throw new Error('No chromium executable found');
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  console.log(`[remote-smoke] loading ${url}`);
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => window.__MC__ && window.__MC__.ready === true, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  const metrics = await page.evaluate(() => window.__MC__.metrics());
  const screensDir = path.join(ROOT, 'artifacts', 'screens');
  fs.mkdirSync(screensDir, { recursive: true });
  const screenshot = path.join(screensDir, shotName);
  await page.screenshot({ path: screenshot });
  const html = await page.content();
  const asset = /assets\/index-[A-Za-z0-9]+\.js/.exec(html)?.[0] ?? '';
  const ok = metrics.columns > 0 && metrics.triangles > 0 && consoleErrors.length === 0 && failedRequests.length === 0;
  const report = { ok, url, asset, metrics, consoleErrors, failedRequests, screenshot };
  fs.writeFileSync(path.join(ROOT, 'artifacts', 'remote-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
