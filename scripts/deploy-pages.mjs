import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Publish MineVerse to GitHub Pages.
 *
 *   pnpm deploy
 *
 * Steps: local verification -> build -> push `main` -> build an orphan
 * `gh-pages` branch with dist/ -> enable/update Pages -> wait for the site ->
 * run a deployed smoke test -> record artifacts/deploy.json.
 *
 * Environment overrides:
 *   REPO=freefoxcm/mineverse   (default)
 *   SKIP_VERIFY=1              skip typecheck/test/build gates
 *   SKIP_PUSH=1                only build the gh-pages worktree (dry run)
 */

const ROOT = process.cwd();
const OWNER_REPO = process.env.REPO ?? 'freefoxcm/mineverse';
const [OWNER, REPO] = OWNER_REPO.split('/');
const PAGES_URL = `https://${OWNER}.github.io/${REPO}/`;
const WORKTREE = path.join(ROOT, '.deploy-gh-pages');
const reportPath = path.join(ROOT, 'artifacts', 'deploy.json');

function log(message) {
  console.log(`[deploy] ${message}`);
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`);
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...options,
  });
}

function tryRun(command, args, options = {}) {
  try {
    return run(command, args, options);
  } catch (error) {
    if (options.allowFailure) return null;
    throw error;
  }
}

function pnpm(args) {
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    shell: process.platform === 'win32',
  });
}

function git(args, options = {}) {
  return run('git', args, options);
}

function gh(args, options = {}) {
  return run('gh', args, options);
}

function removeDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function ensureBuild() {
  const dist = path.join(ROOT, 'dist');
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) throw new Error('dist/index.html missing — build failed?');
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  return dist;
}

function verify() {
  if (process.env.SKIP_VERIFY === '1') {
    log('SKIP_VERIFY=1, skipping typecheck/test/build');
    return;
  }
  pnpm(['typecheck']);
  pnpm(['test']);
  pnpm(['build']);
}

function ensureRepository() {
  const view = tryRun('gh', ['repo', 'view', OWNER_REPO, '--json', 'name,visibility'], {
    capture: true,
    allowFailure: true,
  });
  if (!view) {
    log(`creating public repository ${OWNER_REPO}`);
    gh(['repo', 'create', OWNER_REPO, '--public', '--description',
      'MineVerse — a Minecraft-like voxel sandbox built from scratch with Three.js + TypeScript']);
  } else {
    const info = JSON.parse(view);
    log(`repository ${OWNER_REPO} exists (${info.visibility})`);
  }
  // Make sure git can push over HTTPS using the gh token.
  tryRun('gh', ['auth', 'setup-git'], { allowFailure: true });
  const remotes = git(['remote'], { capture: true });
  if (!remotes.includes('origin')) {
    git(['remote', 'add', 'origin', `https://github.com/${OWNER_REPO}.git`]);
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).trim();
  if (branch !== 'main') log(`warning: current branch is ${branch}, not main`);
  if (process.env.SKIP_PUSH !== '1') {
    git(['add', '-A']);
    try {
      git(['commit', '-m', `release: MineVerse ${new Date().toISOString().slice(0, 10)}`], { allowFailure: true });
    } catch {
      // nothing to commit
    }
    git(['push', '-u', 'origin', 'main']);
    tryRun('git', ['tag', '-f', 'v1.0.0'], { allowFailure: true });
    tryRun('git', ['push', '-f', 'origin', 'v1.0.0'], { allowFailure: true });
  } else {
    log('SKIP_PUSH=1, skipping main/tag push');
  }
}

function publishGhPages(dist) {
  log('preparing orphan gh-pages branch');
  removeDir(WORKTREE);
  git(['worktree', 'prune']);
  git(['worktree', 'add', '--detach', WORKTREE]);
  const worktreeGit = (args, options = {}) => git(['-C', WORKTREE, ...args], options);
  worktreeGit(['checkout', '--orphan', 'gh-pages']);
  tryRun('git', ['-C', WORKTREE, 'rm', '-rf', '--ignore-unmatch', '.'], { allowFailure: true });
  for (const entry of fs.readdirSync(WORKTREE)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(WORKTREE, entry), { recursive: true, force: true });
  }
  fs.cpSync(dist, WORKTREE, { recursive: true });
  worktreeGit(['add', '-A']);
  worktreeGit(['commit', '-m', `deploy: ${new Date().toISOString()}`]);
  if (process.env.SKIP_PUSH !== '1') {
    worktreeGit(['push', '-f', 'origin', 'gh-pages']);
  } else {
    log('SKIP_PUSH=1, gh-pages worktree built locally (not pushed)');
  }
  git(['worktree', 'remove', '--force', WORKTREE]);
  git(['worktree', 'prune']);
}

function enablePages() {
  if (process.env.SKIP_PUSH === '1') return;
  log('configuring GitHub Pages (source: gh-pages /)');
  const existing = tryRun('gh', ['api', `repos/${OWNER_REPO}/pages`], { capture: true, allowFailure: true });
  if (existing) {
    try {
      gh([
        'api', '--method', 'PUT', `repos/${OWNER_REPO}/pages`,
        '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/',
        '-f', 'build_type=legacy',
      ]);
    } catch (error) {
      log(`PUT pages failed: ${String(error)}`);
    }
  } else {
    try {
      gh([
        'api', '--method', 'POST', `repos/${OWNER_REPO}/pages`,
        '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/',
        '-f', 'build_type=legacy',
      ]);
    } catch (error) {
      log(`POST pages failed: ${String(error)}`);
      log('如果 API 无权限，请手动在仓库 Settings → Pages 选择 gh-pages 分支，然后重新运行（脚本会继续验证）。');
      return;
    }
  }
  tryRun(
    'gh',
    [
      'repo', 'edit', OWNER_REPO,
      '--homepage', PAGES_URL,
      '--add-topic', 'minecraft',
      '--add-topic', 'voxel',
      '--add-topic', 'threejs',
      '--add-topic', 'webgl',
      '--add-topic', 'typescript',
      '--add-topic', 'game',
    ],
    { capture: true, allowFailure: true },
  );
}

async function waitForSite(timeoutMs = 240000) {
  if (process.env.SKIP_PUSH === '1') return false;
  const start = Date.now();
  let lastStatus = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${PAGES_URL}?cachebust=${Date.now()}`, { redirect: 'follow' });
      lastStatus = response.status;
      if (response.ok) {
        const html = await response.text();
        if (html.includes('MineVerse') || html.includes('assets/')) {
          log(`site is live: ${PAGES_URL}`);
          return true;
        }
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  log(`site did not become ready (last HTTP status ${lastStatus})`);
  return false;
}

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

async function deployedSmoke() {
  if (process.env.SKIP_PUSH === '1') return { skipped: true };
  const { chromium } = await import('playwright-core');
  const executablePath = findChromium();
  if (!executablePath) return { ok: false, error: 'no chromium executable' };
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  const result = { ok: false, url: PAGES_URL, consoleErrors, screenshot: null, metrics: null };
  try {
    await page.goto(PAGES_URL, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => window.__MC__ && window.__MC__.ready === true, null, { timeout: 90000 });
    await page.waitForTimeout(1000);
    result.metrics = await page.evaluate(() => window.__MC__.metrics());
    const shotsDir = path.join(ROOT, 'artifacts', 'screens');
    fs.mkdirSync(shotsDir, { recursive: true });
    const screenshotPath = path.join(shotsDir, 'deployed.png');
    await page.screenshot({ path: screenshotPath });
    result.screenshot = screenshotPath;
    result.ok = Boolean(result.metrics?.columns > 0 && result.metrics?.triangles > 0 && consoleErrors.length === 0);
  } catch (error) {
    result.error = String(error);
  } finally {
    await browser.close();
  }
  return result;
}

(async () => {
  fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
  const result = { ok: false, startedAt: new Date().toISOString(), repo: OWNER_REPO, tags: ['v1.0.0'] };
  try {
    verify();
    ensureBuild();
    if (process.env.SKIP_PUSH !== '1') {
      ensureRepository();
    } else {
      log('SKIP_PUSH=1, skipping repository creation/push');
    }
    publishGhPages(path.join(ROOT, 'dist'));
    enablePages();
    const live = await waitForSite();
    const smoke = await deployedSmoke();
    result.live = live;
    result.smoke = smoke;
    result.ok = live && smoke.ok === true;
    if (result.ok) log(`published successfully: ${PAGES_URL}`);
    else log('publish verification failed; inspect artifacts/deploy.json');
  } catch (error) {
    result.error = String(error);
    console.error(error);
  } finally {
    result.finishedAt = new Date().toISOString();
    result.pagesUrl = PAGES_URL;
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  }
  process.exit(result.ok ? 0 : 1);
})();
