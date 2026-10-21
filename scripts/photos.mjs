import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Generates the clean marketing screenshots in docs/screenshots/ from a fresh
 * game session (no death drops, chat spam or debug entities).
 *
 * Requires dist/ (run `pnpm build` first). Starts its own preview server.
 */

const ROOT = process.cwd();
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(ROOT, 'docs', 'screenshots');

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

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('preview server did not start');
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
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('run pnpm build first');
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = await import('playwright-core');
  const executablePath = findChromium();
  if (!executablePath) throw new Error('no chromium found');
  const server = startPreview();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  const wait = (ms) => page.waitForTimeout(ms);
  const evaluate = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => {
    // Hide any lingering toast/narration so the screenshots stay clean.
    await evaluate(() => {
      document.querySelectorAll('.mv-toast, .toast').forEach((element) => {
        element.className = element.classList.contains('mv-toast') ? 'mv-toast' : 'toast';
        element.style.display = 'none';
      });
    });
    await wait(80);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`[photos] ${name}.png`);
  };

  try {
    await waitForServer(BASE);
    await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => window.__MC__ && window.__MC__.ready === true, null, { timeout: 90000 });
    await wait(900);

    // Starter kit comes from a fresh world; keep slot 8 empty for the bare-hand shot.
    await evaluate(() => {
      const mc = window.__MC__;
      mc.selectSlot(8);
      mc.setTime(4000);
      mc.setBlockOutlineVisible(false);
      mc.setHandVisible(false);
    });
    await wait(500);

    // Find a forest-edge grassland: open sky above the camera, no water in front,
    // and a cluster of trees around for a scenic composition.
    const scenic = await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const grass = mc.blockId('grass_block');
      const treeBlocks = new Set(
        ['oak_log', 'birch_log', 'spruce_log', 'oak_leaves', 'birch_leaves', 'spruce_leaves'].map((name) => mc.blockId(name)),
      );
      const water = mc.blockId('water');
      const sandId = mc.blockId('sand');
      let best = null;
      let bestScore = -Infinity;
      for (let r = 16; r <= 176; r += 8) {
        for (let a = 0; a < 16; a++) {
          const angle = (a / 16) * Math.PI * 2;
          const x = Math.round(p.x + Math.cos(angle) * r);
          const z = Math.round(p.z + Math.sin(angle) * r);
          let surface = -1;
          for (let y = 120; y > 55; y--) {
            if (mc.getBlock(x, y, z) !== 0) {
              surface = y;
              break;
            }
          }
          if (surface < 65 || surface > 108) continue;
          if (mc.getBlock(x, surface, z) !== grass) continue;
          let open = true;
          for (let dy = 1; dy <= 13 && open; dy++) {
            if (mc.getBlock(x, surface + dy, z) !== 0) open = false;
          }
          if (!open) continue;
          // Reject beach/coast framing: no water nearby at sea level.
          let coast = false;
          for (let d = 3; d <= 12 && !coast; d += 3) {
            for (let k = 0; k < 8; k++) {
              const aa = (k / 8) * Math.PI * 2;
              if (mc.getBlock(Math.round(x + Math.cos(aa) * d), 63, Math.round(z + Math.sin(aa) * d)) === water) coast = true;
            }
          }
          if (coast) continue;
          // Prefer grassland/forest rather than desert: sample surface blocks around.
          let sand = 0;
          let green = 0;
          for (let k = 0; k < 16; k++) {
            const aa = (k / 16) * Math.PI * 2;
            const radius = k % 2 === 0 ? 8 : 14;
            const sx = Math.round(x + Math.cos(aa) * radius);
            const sz = Math.round(z + Math.sin(aa) * radius);
            let sy = -1;
            for (let yy = 120; yy > 55; yy--) {
              if (mc.getBlock(sx, yy, sz) !== 0) {
                sy = yy;
                break;
              }
            }
            if (sy < 0) continue;
            const top = mc.getBlock(sx, sy, sz);
            if (top === sandId) sand += 1;
            else if (top === grass) green += 1;
          }
          if (sand > green || green < 8) continue;
          // Count tree blocks in a wide ring and remember their average direction.
          let trees = 0;
          let dirX = 0;
          let dirZ = 0;
          for (let gx = -20; gx <= 20; gx += 5) {
            for (let gz = -20; gz <= 20; gz += 5) {
              if (gx === 0 && gz === 0) continue;
              for (let dy = -1; dy <= 14; dy++) {
                if (treeBlocks.has(mc.getBlock(x + gx, surface + dy, z + gz))) {
                  trees += 1;
                  dirX += gx;
                  dirZ += gz;
                  break;
                }
              }
            }
          }
          if (trees < 5) continue;
          let flowers = 0;
          for (let gx = -10; gx <= 10; gx += 3) {
            for (let gz = -10; gz <= 10; gz += 3) {
              const block = mc.getBlock(x + gx, surface + 1, z + gz);
              if (block === mc.blockId('poppy') || block === mc.blockId('dandelion')) flowers += 1;
            }
          }
          const score = Math.min(trees, 90) + Math.min(flowers, 8) * 2;
          if (score > bestScore) {
            bestScore = score;
            const yaw = dirX === 0 && dirZ === 0 ? 2.35 : Math.atan2(-dirX, -dirZ);
            best = { x: x + 0.5, y: surface + 1, z: z + 0.5, yaw, trees, flowers };
          }
        }
      }
      return best ?? { x: p.x, y: p.y, z: p.z, yaw: 2.35, trees: 0, flowers: 0 };
    });
    await evaluate((pos) => window.__MC__.teleport(pos.x, pos.y, pos.z), scenic);
    await evaluate((pos) => window.__MC__.look(pos.yaw, -0.06), scenic);
    await wait(1600);
    await evaluate(() => {
      document.querySelectorAll('.toast').forEach((element) => {
        element.className = 'toast';
      });
    });
    await shot('hero');

    // Aerial landscape (creative flight) to show biomes/forests/canopy.
    await evaluate((pos) => {
      const mc = window.__MC__;
      mc.setGamemode('creative');
      mc.setFlying(true);
      mc.teleport(pos.x, pos.y + 16, pos.z);
      mc.look(pos.yaw, -0.4);
      document.querySelectorAll('.toast').forEach((element) => {
        element.className = 'toast';
      });
    }, scenic);
    await wait(1400);
    await shot('hero-aerial');
    await evaluate((pos) => {
      const mc = window.__MC__;
      mc.setFlying(false);
      mc.setGamemode('survival');
      mc.teleport(pos.x, pos.y, pos.z);
      mc.setBlockOutlineVisible(false);
      mc.look(pos.yaw, -0.06);
      document.querySelectorAll('.toast').forEach((element) => {
        element.className = 'toast';
      });
    }, scenic);
    await wait(900);

    // Empty-hand first-person arm (the game always shows the player's arm like Minecraft).
    await evaluate((pos) => {
      const mc = window.__MC__;
      document.querySelectorAll('.toast').forEach((element) => {
        element.className = 'toast';
      });
      mc.setHandVisible(true);
      mc.selectSlot(8); // starter kit leaves this slot empty
      mc.look(pos.yaw, -0.12);
    }, scenic);
    await wait(600);
    await shot('hand');

    // Held-item 3D views: starter kit slots 0..7 (pickaxe/axe/sword/torch/
    // planks/cobble/crafting table/apple), slot 8 is empty.
    for (const [slot, name] of [
      [0, 'held-pickaxe'],
      [2, 'held-sword'],
      [4, 'held-block'],
      [7, 'held-apple'],
    ]) {
      await evaluate((slotIndex) => {
        window.__MC__.setHandVisible(true);
        window.__MC__.selectSlot(slotIndex);
      }, slot);
      await wait(450);
      await shot(name);
    }
    await evaluate(() => {
      window.__MC__.setHandVisible(false);
      window.__MC__.selectSlot(8);
    });
    await evaluate(() => {
      window.__MC__.setHandVisible(false);
      window.__MC__.selectSlot(0);
    });

    // Third person.
    await evaluate(() => window.__MC__.setThirdPerson(true));
    await wait(500);
    await shot('third-person');
    await evaluate(() => window.__MC__.setThirdPerson(false));

    // Sunset sky / sun.
    await evaluate(() => {
      const mc = window.__MC__;
      mc.setTime(11800);
      const angle = (11800 / 24000) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const dirZ = 0.22;
      const length = Math.hypot(dirX, dirY, dirZ);
      mc.look(Math.atan2(-dirX / length, -dirZ / length), Math.asin(dirY / length));
    });
    await wait(700);
    await shot('sunset');
    await evaluate(() => window.__MC__.setTime(6000));

    // Underwater.
    const water = await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const waterId = mc.blockId('water');
      for (let r = 4; r <= 90; r += 4) {
        for (let a = 0; a < 16; a++) {
          const angle = (a / 16) * Math.PI * 2;
          const x = Math.round(p.x + Math.cos(angle) * r);
          const z = Math.round(p.z + Math.sin(angle) * r);
          if (mc.getBlock(x, 61, z) === waterId && mc.getBlock(x, 62, z) === waterId) {
            mc.teleport(x + 0.5, 59.5, z + 0.5);
            return { x, z, back: { x: p.x, y: p.y, z: p.z } };
          }
        }
      }
      return null;
    });
    if (water) {
      await wait(1600);
      await shot('underwater');
      await evaluate((pos) => window.__MC__.teleport(pos.x, pos.y, pos.z), water.back);
      await wait(800);
    }

    // Cave with torchlight.
    await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const cx = Math.floor(p.x);
      const cz = Math.floor(p.z);
      const cy = 34;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = 0; dy <= 2; dy++) mc.setBlock(cx + dx, cy + dy, cz + dz, 0);
      const torch = mc.blockId('torch');
      mc.setBlock(cx + 3, cy + 1, cz, torch);
      mc.setBlock(cx - 3, cy + 1, cz, torch);
      mc.setBlock(cx, cy + 1, cz + 3, torch);
      mc.teleport(cx + 0.5, cy, cz + 0.5);
      mc.look(0.8, -0.03);
    });
    await wait(1200);
    await shot('cave');
    await evaluate((pos) => window.__MC__.teleport(pos.x, pos.y, pos.z), scenic);
    await wait(900);

    // Inventory + creative.
    await evaluate(() => window.__MC__.openScreen('inventory'));
    await wait(400);
    await shot('inventory');
    await evaluate(() => window.__MC__.openScreen('creative'));
    await wait(400);
    await shot('creative');
    await evaluate(() => window.__MC__.openScreen('none'));
    await wait(250);

    // Dropped item sprites (2D item icons instead of coloured cubes).
    await evaluate(() => {
      const mc = window.__MC__;
      const yaw = mc.player.yaw;
      mc.spawnItem('diamond_pickaxe', 1);
      mc.spawnItem('apple', 3);
      mc.spawnItem('oak_planks', 8);
      mc.spawnItem('torch', 4);
      mc.look(yaw, -0.75);
    });
    await wait(260);
    await shot('item-drop');
    await evaluate(() => window.__MC__.clearEntities());

    // Mobs at sunset (creative so nobody gets hit).
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
      mc.look(yaw, -0.08);
    });
    await wait(500);
    await shot('night-mobs');

    // Explosion.
    await evaluate(() => {
      const mc = window.__MC__;
      const p = mc.player.position;
      const yaw = mc.player.yaw;
      mc.explode(p.x - Math.sin(yaw) * 10, p.y + 1, p.z - Math.cos(yaw) * 10, 3);
    });
    await wait(170);
    await shot('explosion');
    await evaluate(() => {
      window.__MC__.clearEntities();
      window.__MC__.setGamemode('survival');
      window.__MC__.setTime(6000);
    });

    // Title flow screens.
    await page.goto(`${BASE}?title=1`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => window.__MC__ && window.__MC__.ready === true, null, { timeout: 90000 });
    await wait(600);
    await shot('title');
    await evaluate(() => window.__MC__.openScreen('worldList'));
    await wait(350);
    await shot('world-list');
    await evaluate(() => window.__MC__.openScreen('createWorld'));
    await wait(350);
    await shot('create-world');

    const report = { ok: errors.length === 0, errors, screenshots: fs.readdirSync(OUT).filter((name) => name.endsWith('.png')) };
    fs.writeFileSync(path.join(ROOT, 'artifacts', 'photos.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('[photos] failed:', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    stopProcess(server);
  }
})();
