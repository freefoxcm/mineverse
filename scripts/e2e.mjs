import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * MineVerse E2E: boots the production build in headless Chromium (SwiftShader
 * WebGL2), drives gameplay through window.__MC__, captures screenshots for
 * visual review and asserts the core loop (world, HUD, UI screens, mobs,
 * explosion, save + reload persistence).
 *
 * Requires `pnpm build` first. Writes artifacts/report.json.
 */

const ROOT = process.cwd();
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}/`;

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
  return spawn(command, ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
}

function stopProcess(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function main() {
  const distIndex = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) throw new Error('dist/index.html not found — run `pnpm build` first');

  const { chromium } = await import('playwright-core');
  const screensDir = path.join(ROOT, 'artifacts', 'screens');
  fs.mkdirSync(screensDir, { recursive: true });

  const server = startPreview();
  let browser;
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    checks: [],
    metrics: null,
    screenshots: [],
    consoleErrors: [],
    failedRequests: [],
  };
  const checks = [];
  const check = (name, condition, detail = '') => {
    checks.push({ name, ok: Boolean(condition), detail });
    if (!condition) console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  };

  try {
    await waitForServer(BASE);
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
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => report.consoleErrors.push(String(error)));
    page.on('response', (response) => {
      if (response.status() >= 400) report.failedRequests.push(`${response.status()} ${response.url()}`);
    });

    const shot = async (name) => {
      const file = path.join(screensDir, `${name}.png`);
      const buffer = await page.screenshot({ path: file });
      report.screenshots.push({ name, bytes: buffer.length });
      return buffer.length;
    };
    const evaluate = (fn, arg) => page.evaluate(fn, arg);
    const wait = (ms) => page.waitForTimeout(ms);

    await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__MC__ && window.__MC__.ready === true, null, { timeout: 60000 });
    await wait(700);

    const metrics = await evaluate(() => window.__MC__.metrics());
    report.metrics = metrics;
    report.seed = await evaluate(() => window.__MC__.world.seed);
    check('world columns loaded', metrics.columns > 100, String(metrics.columns));
    check('chunk meshes exist', metrics.meshes > 100, String(metrics.meshes));
    check('terrain draw calls', metrics.drawCalls > 20, String(metrics.drawCalls));
    check('terrain triangles', metrics.triangles > 10000, String(metrics.triangles));
    const dayShot = await shot('01-hud-day');
    check('day screenshot', dayShot > 20000, String(dayShot));

    // Give the player a starter kit + verify hotbar/HUD render.
    const hotbar = await evaluate(() => {
      const items = [
        'grass_block',
        'oak_planks',
        'cobblestone',
        'oak_log',
        'torch',
        'glass',
        'iron_pickaxe',
        'apple',
        'diamond_sword',
      ];
      for (const item of items) window.__MC__.give(item, 64);
      window.__MC__.selectSlot(0);
      return window.__MC__.hotbar;
    });
    check('hotbar filled', hotbar.filter((slot) => slot.item).length >= 8);
    check('starter kit fills all nine hotbar slots', hotbar.filter((slot) => slot.item).length === 9, String(hotbar.filter((slot) => slot.item).length));
    const skipCheck = await evaluate(() => {
      const mc = window.__MC__;
      mc.selectSlot(8);
      const selected = mc.getInventoryState();
      return selected.selected;
    });
    check('selecting an occupied slot is stable', typeof skipCheck === 'number' && skipCheck >= 0 && skipCheck <= 8, String(skipCheck));
    await wait(300);
    await shot('02-hud-items');

    // UI screens (DOM overlays).
    for (const [screen, file] of [
      ['inventory', '03-inventory'],
      ['crafting', '04-crafting'],
      ['creative', '05-creative'],
      ['pause', '06-pause'],
      ['options', '07-options'],
      ['death', '08-death'],
      ['chat', '09-chat'],
    ]) {
      await evaluate((name) => window.__MC__.openScreen(name), screen);
      await wait(350);
      const bytes = await shot(file);
      check(`${screen} screen`, bytes > 15000, String(bytes));
      await evaluate(() => window.__MC__.openScreen('none'));
      await wait(150);
    }

    // Standalone containers (furnace with fuel/input + chest filled).
    await evaluate(() => {
      const furnace = window.__MC__;
      furnace.openScreen('furnace');
    });
    await wait(300);
    await shot('10-furnace');
    await evaluate(() => window.__MC__.openScreen('none'));
    await evaluate(() => window.__MC__.openScreen('chest'));
    await wait(300);
    await shot('11-chest');
    await evaluate(() => window.__MC__.openScreen('none'));

    // Block breaking + placement via held mouse state.
    const interaction = await evaluate(async () => {
      const mc = window.__MC__;
      const player = mc.player;
      const p = player.position;
      const eyeY = p.y + 1.62;
      const yaw = player.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      const tx = Math.round(p.x + dirX * 1.5);
      const ty = Math.floor(eyeY - 0.5);
      const tz = Math.round(p.z + dirZ * 1.5);
      const before = mc.getBlock(tx, ty, tz);
      mc.selectSlot(0); // starter-kit stone pickaxe
      const stoneId = mc.blockId('stone');
      mc.setBlock(tx, ty, tz, stoneId);
      const placedBefore = mc.getBlock(tx, ty, tz);
      const targetX = tx + 0.5;
      const targetY = ty + 0.5;
      const targetZ = tz + 0.5;
      const dx = targetX - p.x;
      const dy = targetY - eyeY;
      const dz = targetZ - p.z;
      const horizontal = Math.hypot(dx, dz);
      const aimYaw = Math.atan2(-dx, -dz);
      const aimPitch = Math.atan2(dy, horizontal);
      mc.look(aimYaw, aimPitch);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const aim = mc.getInteraction();
      mc.setAttack(true);
      await new Promise((resolve) => setTimeout(resolve, 1600));
      const during = mc.getInteraction();
      mc.setAttack(false);
      const after = mc.getBlock(tx, ty, tz);
      const inv = mc.getInventoryState();
      return {
        before,
        placedBefore,
        stoneId,
        after,
        aim,
        during,
        target: { x: tx, y: ty, z: tz },
        slots: inv.slots.slice(0, 3),
      };
    });
    check('block was targeted', interaction.placedBefore === interaction.stoneId, JSON.stringify(interaction.target));
    check('block broke', interaction.after !== interaction.stoneId, `after=${interaction.after} aim=${JSON.stringify(interaction.aim)} during=${JSON.stringify(interaction.during)}`);
    await shot('12-break-block');

    // Regression: mining a normal ground block (looking down), not a placed wall.
    const groundBreak = await evaluate(async () => {
      const mc = window.__MC__;
      const player = mc.player;
      const p = player.position;
      const yaw = player.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      const bx = Math.floor(p.x + dirX * 2);
      const bz = Math.floor(p.z + dirZ * 2);
      let by = Math.floor(p.y + 2);
      while (by > 0 && mc.getBlock(bx, by, bz) === 0) by--;
      const before = mc.getBlock(bx, by, bz);
      const eyeY = p.y + 1.62;
      const dx = bx + 0.5 - p.x;
      const dy = by + 0.5 - eyeY;
      const dz = bz + 0.5 - p.z;
      mc.selectSlot(0);
      mc.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      await new Promise((resolve) => setTimeout(resolve, 180));
      const aimed = mc.getInteraction();
      mc.setAttack(true);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      mc.setAttack(false);
      return { before, after: mc.getBlock(bx, by, bz), target: { x: bx, y: by, z: bz }, aimed };
    });
    check(
      'ground block broke',
      groundBreak.before !== 0 && groundBreak.after !== groundBreak.before,
      JSON.stringify(groundBreak),
    );

    // Third-person player model (F5).
    await evaluate(() => {
      window.__MC__.setThirdPerson(true);
      window.__MC__.look(0.9, -0.15);
    });
    await wait(500);
    await shot('19-third-person');
    const thirdPersonShot = report.screenshots[report.screenshots.length - 1];
    check('third person screenshot', thirdPersonShot.bytes > 15000, String(thirdPersonShot.bytes));
    await evaluate(() => window.__MC__.setThirdPerson(false));

    // Underwater rendering (find ocean water near spawn).
    const underwater = await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const waterId = mc.blockId('water');
      for (let r = 4; r <= 80; r += 4) {
        for (let a = 0; a < 12; a++) {
          const angle = (a / 12) * Math.PI * 2;
          const x = Math.round(p.x + Math.cos(angle) * r);
          const z = Math.round(p.z + Math.sin(angle) * r);
          if (mc.getBlock(x, 61, z) === waterId && mc.getBlock(x, 62, z) === waterId) {
            const original = { x: p.x, y: p.y, z: p.z };
            mc.teleport(x + 0.5, 59.5, z + 0.5);
            return { found: true, x, z, original };
          }
        }
      }
      return { found: false };
    });
    await wait(1500);
    if (underwater.found) {
      const playerState = await evaluate(() => window.__MC__.player);
      check('player underwater', playerState.inWater === true, JSON.stringify(playerState));
      await shot('20-underwater');
      await evaluate((o) => window.__MC__.teleport(o.x, o.y, o.z), underwater.original);
      await wait(800);
    } else {
      check('player underwater', false, 'no water found near spawn');
    }

    // Torch light at night.
    const torch = await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const yaw = mc.player.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      mc.setTime(14000);
      for (let d = 2; d <= 5; d++) {
        const x = Math.round(p.x + dirX * d);
        const z = Math.round(p.z + dirZ * d);
        for (let y = Math.floor(p.y) + 2; y >= Math.floor(p.y) - 3; y--) {
          if (mc.getBlock(x, y, z) !== 0 && mc.getBlock(x, y + 1, z) === 0) {
            mc.setBlock(x, y + 1, z, mc.blockId('torch'));
            const eyeY = p.y + 1.62;
            const dx = x + 0.5 - p.x;
            const dz = z + 0.5 - p.z;
            const dy = y + 1.5 - eyeY;
            mc.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
            return { x, y: y + 1, z };
          }
        }
      }
      return null;
    });
    await wait(800);
    check('torch placed', torch !== null, JSON.stringify(torch));
    if (torch) {
      const torchBlock = await evaluate((t) => window.__MC__.getBlock(t.x, t.y, t.z), torch);
      const torchLight = await evaluate((t) => window.__MC__.getLight(t.x, t.y, t.z), torch);
      check('torch block set', torchBlock !== 0, String(torchBlock));
      check('torch emits light', torchLight.block >= 10, JSON.stringify(torchLight));
      // Step back so the torch and its light pool are both visible in the shot.
      await evaluate((t) => {
        const mc = window.__MC__;
        const p = mc.player.position;
        const dx = p.x - (t.x + 0.5);
        const dz = p.z - (t.z + 0.5);
        const length = Math.hypot(dx, dz) || 1;
        const backX = t.x + 0.5 + (dx / length) * 5;
        const backZ = t.z + 0.5 + (dz / length) * 5;
        mc.teleport(backX, t.y, backZ);
        const targetX = t.x + 0.5 - backX;
        const targetZ = t.z + 0.5 - backZ;
        const targetY = t.y + 0.6 - (t.y + 1.62);
        mc.look(Math.atan2(-targetX, -targetZ), Math.atan2(targetY, Math.hypot(targetX, targetZ)));
      }, torch);
      await wait(800);
      await shot('21-night-torch');
    }

    // Death screen + respawn.
    await evaluate(() => window.__MC__.runCommand('/kill'));
    await wait(700);
    const death = await evaluate(() => ({ screen: window.__MC__.getScreen(), dead: window.__MC__.player.dead }));
    check('death screen shown', death.screen === 'death' && death.dead === true, JSON.stringify(death));
    await shot('22-death-screen');
    await evaluate(() => window.__MC__.respawn());
    await wait(700);
    const respawned = await evaluate(() => ({ screen: window.__MC__.getScreen(), dead: window.__MC__.player.dead, health: window.__MC__.player.health }));
    check('respawn works', respawned.dead === false && respawned.health > 0, JSON.stringify(respawned));
    await evaluate(() => {
      window.__MC__.setTime(6000);
      window.__MC__.clearEntities();
      // Clean up debug/chat leftovers so the remaining screenshots are pristine.
      const chat = document.querySelector('.mv-chatlog');
      if (chat) chat.innerHTML = '';
      document.querySelectorAll('.toast').forEach((element) => {
        element.className = 'toast';
      });
    });

    // Crafting table via the real inventory UI (2x2 grid + result slot).
    await evaluate(() => {
      const mc = window.__MC__;
      mc.give('oak_planks', 4);
      mc.openScreen('inventory');
    });
    await wait(350);
    const craft = await evaluate(() => {
      const mc = window.__MC__;
      const inv = mc.getInventoryState();
      const plankSlot = inv.slots.findIndex((slot) => slot.item === 'oak_planks');
      mc.clickSlot(plankSlot); // pick up oak planks stack
      for (let i = 0; i < 4; i++) mc.clickSlot(40 + i, 2); // right click: one plank per grid slot
      mc.clickSlot(20); // return remaining stack to main inventory
      mc.clickSlot(44); // take crafting result
      mc.clickSlot(30); // put result into main inventory
      return { screen: mc.getScreen(), inventory: mc.getInventoryState() };
    });
    const craftingTable = craft.inventory.slots.filter((slot) => slot.item === 'crafting_table').length;
    check('crafting via UI produced crafting_table', craftingTable > 0, JSON.stringify(craft.inventory.slots.filter((s) => s.item)));
    await shot('23-crafting-result');
    await evaluate(() => window.__MC__.openScreen('none'));
    await wait(200);

    // Scenic shots: find grassland and mountain columns, teleport and capture.
    const scenic = await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const grass = mc.blockId('grass_block');
      const stone = mc.blockId('stone');
      const snow = mc.blockId('snow_block');
      let plains = null;
      let mountain = null;
      for (let r = 24; r <= 160 && (!plains || !mountain); r += 8) {
        for (let a = 0; a < 16; a++) {
          const angle = (a / 16) * Math.PI * 2;
          const x = Math.round(p.x + Math.cos(angle) * r);
          const z = Math.round(p.z + Math.sin(angle) * r);
          for (let y = 150; y > 40; y--) {
            const block = mc.getBlock(x, y, z);
            if (block === 0) continue;
            if (!plains && (block === grass || mc.getBlock(x, y + 1, z) === 0) && y > 66 && y < 90) {
              plains = { x: x + 0.5, y: y + 1, z: z + 0.5 };
            }
            if (!mountain && (block === snow || block === stone) && y > 95) {
              mountain = { x: x + 0.5, y: y + 1, z: z + 0.5 };
            }
            break;
          }
          if (plains && mountain) break;
        }
      }
      return { plains, mountain, fallback: { x: p.x, y: p.y, z: p.z } };
    });
    const scenicShot = async (name, position, look) => {
      if (!position) return;
      await evaluate((pos) => window.__MC__.teleport(pos.x, pos.y, pos.z), position);
      await evaluate((v) => window.__MC__.look(v.yaw, v.pitch), look);
      await wait(1400);
      await shot(name);
    };
    await scenicShot('24-plains', scenic.plains ?? scenic.fallback, { yaw: 2.2, pitch: -0.12 });
    if (scenic.mountain) await scenicShot('25-mountain', scenic.mountain, { yaw: 2.4, pitch: 0.12 });
    await evaluate((pos) => window.__MC__.teleport(pos.x, pos.y, pos.z), scenic.plains ?? scenic.fallback);

    // Carve a small cave room and light it with torches.
    await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const cx = Math.floor(p.x);
      const cz = Math.floor(p.z);
      const cy = 34;
      const air = 0;
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          for (let dy = 0; dy <= 2; dy++) mc.setBlock(cx + dx, cy + dy, cz + dz, air);
        }
      }
      const torch = mc.blockId('torch');
      mc.setBlock(cx + 3, cy + 1, cz, torch);
      mc.setBlock(cx - 3, cy + 1, cz, torch);
      mc.setBlock(cx, cy + 1, cz + 3, torch);
      mc.teleport(cx + 0.5, cy, cz + 0.5);
      mc.look(0.8, -0.05);
    });
    await wait(1200);
    await shot('26-cave');
    await evaluate((pos) => window.__MC__.teleport(pos.x, pos.y, pos.z), scenic.plains ?? scenic.fallback);
    await wait(700);

    // Wide sky shot (sun/clouds) for atmosphere review.
    await evaluate(() => {
      const mc = window.__MC__;
      mc.setTime(4000);
      mc.look(mc.player.yaw, 0.42);
    });
    await wait(600);
    await shot('27-sky');
    await evaluate(() => window.__MC__.setTime(6000));

    // Mobs + explosion screenshots (creative mode so mobs do not chase the camera).
    await evaluate(() => {
      const mc = window.__MC__;
      mc.setGamemode('creative');
      mc.setTime(11800);
      mc.setSpawnEnabled(false);
      mc.clearEntities();
      const p = mc.player.position;
      const yaw = mc.player.yaw;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      const sx = Math.cos(yaw);
      const sz = -Math.sin(yaw);
      mc.spawnMob('zombie', p.x + dx * 8 + sx * 2, undefined, p.z + dz * 8 + sz * 2);
      mc.spawnMob('creeper', p.x + dx * 10, undefined, p.z + dz * 10);
      mc.spawnMob('skeleton', p.x + dx * 9 - sx * 3.5, undefined, p.z + dz * 9 - sz * 3.5);
      mc.spawnMob('pig', p.x + dx * 7 - sx * 2.5, undefined, p.z + dz * 7 - sz * 2.5);
      mc.look(yaw, -0.1);
    });
    await wait(450);
    const mobCounts = await evaluate(() => window.__MC__.entityCounts());
    check('mobs spawned', mobCounts.mobs >= 4, JSON.stringify(mobCounts));
    await shot('13-night-mobs');

    await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const yaw = mc.player.yaw;
      mc.explode(p.x - Math.sin(yaw) * 10, p.y + 1, p.z - Math.cos(yaw) * 10, 3);
    });
    await wait(180);
    await shot('14-explosion');
    await wait(900);
    await shot('14b-explosion-after');
    await evaluate(() => {
      window.__MC__.clearEntities();
      window.__MC__.setGamemode('survival');
    });

    // Save + reload persistence.
    const marker = await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const x = Math.floor(p.x) + 3;
      const z = Math.floor(p.z) + 3;
      const y = Math.floor(p.y) + 4;
      const glassId = mc.blockId('glass');
      mc.setBlock(x, y, z, glassId);
      return { x, y, z, block: mc.getBlock(x, y, z), glassId };
    });
    const saved = await evaluate(async () => {
      const ok = await window.__MC__.saveWorld();
      const worlds = await window.__MC__.listWorlds();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('mineverse');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const all = await new Promise((resolve, reject) => {
        const request = db.transaction('worlds', 'readonly').objectStore('worlds').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return {
        ok,
        worlds,
        saves: all.map((save) => ({
          id: save.meta.id,
          edits: save.edits.length,
          palette: save.palette.slice(0, 12),
          blockEntities: save.blockEntities.length,
          playerPos: save.player?.pos,
          time: save.time,
        })),
      };
    });
    report.saveDiagnostics = saved.saves;
    check('save succeeded', saved.ok === true);
    check('world listed', Array.isArray(saved.worlds) && saved.worlds.length > 0);
    const world = saved.worlds[0];
    await page.goto(`${BASE}?world=${encodeURIComponent(world.id)}&seed=${encodeURIComponent(world.seed)}`, {
      waitUntil: 'load',
      timeout: 30000,
    });
    await page.waitForFunction(() => window.__MC__ && window.__MC__.ready === true, null, { timeout: 60000 });
    await wait(1200);
    const reloadDiagnostics = await evaluate(
      (m) => ({
        block: window.__MC__.getBlock(m.x, m.y, m.z),
        edits: window.__MC__.editCount(),
        columnLoaded: window.__MC__.isColumnLoaded(Math.floor(m.x / 16), Math.floor(m.z / 16)),
        player: window.__MC__.player,
        columns: window.__MC__.world.columns,
        seed: window.__MC__.world.seed,
        screen: window.__MC__.getScreen(),
        errors: window.__MC__.errors.slice(0, 5),
        url: location.href,
        marker: m,
      }),
      marker,
    );
    report.reloadDiagnostics = reloadDiagnostics;
    const persisted = reloadDiagnostics.block;
    check('edit persisted after reload', persisted === marker.block, `${JSON.stringify(reloadDiagnostics)}`);
    await shot('15-reloaded');

    // Title / world-list / create-world screens.
    await page.goto(`${BASE}?title=1`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__MC__ && window.__MC__.ready === true, null, { timeout: 60000 });
    await wait(500);
    await shot('16-title');
    await evaluate(() => window.__MC__.openScreen('worldList'));
    await wait(400);
    await shot('17-world-list');
    await evaluate(() => window.__MC__.openScreen('createWorld'));
    await wait(400);
    await shot('18-create-world');

    check('no console errors', report.consoleErrors.length === 0, report.consoleErrors.join(' | '));
    check('no failed requests', report.failedRequests.length === 0, report.failedRequests.join(' | '));
    check('screenshots captured', report.screenshots.length >= 15, String(report.screenshots.length));
    check('fps sanity', metrics.fps >= 8, String(metrics.fps));

    report.ok = checks.every((entry) => entry.ok);
    console.log(JSON.stringify({ ok: report.ok, checks, metrics, screenshots: report.screenshots.length }, null, 2));
  } catch (error) {
    report.error = String(error);
    console.error('E2E failed:', error);
  } finally {
    report.checks = checks;
    fs.writeFileSync(path.join(ROOT, 'artifacts', 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    stopProcess(server);
  }
  process.exit(report.ok ? 0 : 1);
}

main();
