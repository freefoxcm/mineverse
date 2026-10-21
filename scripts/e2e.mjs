import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * M0 screenshot smoke test.
 * Requires `pnpm build` to have produced dist/. Starts `vite preview`, opens the
 * page in headless Chromium (SwiftShader WebGL2), waits for __MC__.ready and
 * captures artifacts/screens/00-smoke.png plus artifacts/report.json.
 */

const ROOT = process.cwd();
const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}/`;

function findChromium() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CHROMIUM) candidates.push(process.env.PLAYWRIGHT_CHROMIUM);
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const playwrightDir = path.join(localAppData, 'ms-playwright');
    if (fs.existsSync(playwrightDir)) {
      const versions = fs
        .readdirSync(playwrightDir)
        .filter((name) => name.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const version of versions) {
        candidates.push(path.join(playwrightDir, version, 'chrome-win64', 'chrome.exe'));
        candidates.push(path.join(playwrightDir, version, 'chrome-win', 'chrome.exe'));
      }
    }
  }
  candidates.push(
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  );
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('No Chromium/Edge executable found for Playwright');
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Preview server did not start at ${url}`);
}

function startPreview() {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const child = spawn(command, ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return child;
}

function stopProcess(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

(async () => {
  const distIndex = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error('dist/index.html not found — run `pnpm build` first');
  }

  const { chromium } = await import('playwright-core');
  const screensDir = path.join(ROOT, 'artifacts', 'screens');
  fs.mkdirSync(screensDir, { recursive: true });

  const server = startPreview();
  let browser;
  const report = { ok: false, url: URL, metrics: null, errors: [], screenshot: null };
  try {
    await waitForServer(URL);
    browser = await chromium.launch({
      executablePath: findChromium(),
      headless: true,
      args: [
        '--enable-unsafe-swiftshader',
        '--use-angle=swiftshader',
        '--disable-gpu-sandbox',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
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

    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__MC__ && window.__MC__.ready === true, null, { timeout: 60000 });
    await page.waitForTimeout(600);

    const metrics = await page.evaluate(() => window.__MC__.metrics());
    const ready = await page.evaluate(() => window.__MC__.ready);
    const screenshotPath = path.join(screensDir, '00-smoke.png');
    const buffer = await page.screenshot({ path: screenshotPath });
    const stats = fs.statSync(screenshotPath);

    report.metrics = metrics;
    report.errors = consoleErrors;
    report.failedRequests = failedRequests;
    report.screenshot = path.relative(ROOT, screenshotPath);
    report.screenshotBytes = stats.size;
    report.ok =
      ready === true &&
      metrics.columns > 0 &&
      metrics.meshes > 0 &&
      metrics.triangles > 0 &&
      stats.size > 20000 &&
      consoleErrors.length === 0 &&
      failedRequests.length === 0;

    console.log(
      JSON.stringify(
        {
          ready,
          metrics,
          screenshotBytes: stats.size,
          consoleErrors,
          failedRequests,
          ok: report.ok,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    report.error = String(error);
    console.error('E2E failed:', error);
  } finally {
    fs.writeFileSync(path.join(ROOT, 'artifacts', 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    stopProcess(server);
  }
  process.exit(report.ok ? 0 : 1);
})();
