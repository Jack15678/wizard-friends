import { chromium } from '@playwright/test';
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [], errors = [];
try {
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    pages.push(page);
    await page.goto(base);
    await page.locator('#nickname').fill(['房主', '蓝巫师', '绿巫师'][i]);
  }
  const host = pages[0];
  await host.locator('#create').click();
  await host.locator('.room-code').waitFor({ timeout: 30000 });
  const room = await host.locator('.room-code').innerText();
  console.log('Host connected to public signaling service');
  for (const p of pages.slice(1)) {
    await p.locator('#room-input').fill(room);
    await p.locator('#join').click();
    await p.locator('.seats').waitFor({ timeout: 30000 });
  }
  await host.locator('#short').check();
  await host.locator('#start').click();
  for (const p of pages) await p.locator('.hand .card').first().waitFor();
  let completed = false;
  for (let i = 0; i < 80; i++) {
    if (await host.locator('#next').count()) { completed = true; break; }
    for (const p of pages) {
      if (await p.locator('[data-trump]').count()) await p.locator('[data-trump]').first().click();
      else if (await p.locator('[data-bid]').count()) await p.locator('[data-bid]').first().click();
      else if (await p.locator('.hand .playable').count()) await p.locator('.hand .playable').first().click();
    }
    await host.waitForTimeout(100);
  }
  if (!completed) throw new Error('First round did not complete');
  for (const p of pages) await p.locator('.round-results').waitFor();
  const scores = await Promise.all(pages.map(p => p.locator('.score-row b').allTextContents()));
  if (scores.some(s => JSON.stringify(s) !== JSON.stringify(scores[0]))) throw new Error('Scores differ between clients');
  await pages[1].reload();
  await pages[1].locator('#join').click();
  await pages[1].locator('.scoreboard').waitFor({ timeout: 30000 });
  await host.locator('#next').click();
  await pages[1].locator('.hand .card').first().waitFor({ timeout: 10000 });
  if (await pages[1].locator('.hand .card').count() !== 2) throw new Error('Rejoined player did not receive round 2 hand');
  console.log(JSON.stringify({ network: '3 independent browser contexts joined over public PeerJS signaling', round: 'completed and scores synchronized', reconnect: 'same-tab guest refresh restored seat and next hand', errors }));
  if (errors.length) throw new Error('Browser errors');
} finally { await browser.close(); }
