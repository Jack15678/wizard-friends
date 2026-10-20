import { chromium, expect } from '@playwright/test';
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
    await p.locator('#join-menu').click();
    await p.locator('#room-input').fill(room);
    await p.locator('#join').click();
    await p.locator('.seats').waitFor({ timeout: 30000 });
  }
  await pages[1].locator('#rename-toggle').click();
  await pages[1].locator('#rename-input').fill('蓝色旅人');
  await pages[1].locator('#rename-form button[type=submit]').click();
  for (const p of pages) await expect(p.locator('.seat-name b')).toContainText(['房主', '蓝色旅人', '绿巫师']);
  await pages[1].locator('#chat-toggle').click();
  await pages[1].locator('#chat-input').fill('<b>大家好</b>');
  await pages[1].locator('#chat-form button').click();
  for (const p of pages) {
    await expect(p.locator('#chat-messages span')).toHaveText(['<b>大家好</b>']);
    await expect(p.locator('#chat-messages span b')).toHaveCount(0);
  }
  await pages[2].locator('#chat-toggle').click();
  await pages[2].locator('#chat-input').fill('保留输入草稿');
  await host.locator('#short').check();
  await expect(pages[2].locator('#short')).toBeChecked();
  await expect(pages[2].locator('#chat-input')).toHaveValue('保留输入草稿');
  await expect(pages[2].locator('#chat-input')).toBeFocused();
  for (const p of pages.slice(1)) await p.locator('#close-chat').click();
  await host.locator('#start').click();
  for (const p of pages) await p.locator('.hand .card').first().waitFor();
  await host.locator('#chat-toggle').click();
  await host.locator('#chat-input').fill('开局了');
  await host.locator('#chat-form button').click();
  for (const p of pages) await expect(p.locator('#chat-messages span').last()).toHaveText('开局了');
  await host.screenshot({ path: '.local/chat-game.png', fullPage: true });
  await host.locator('#close-chat').click();
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
  for (const p of pages) {
    await p.locator('#table-scores').click();
    await p.locator('.round-results').waitFor();
  }
  const scores = await Promise.all(pages.map(p => p.locator('.score-row b').allTextContents()));
  if (scores.some(s => JSON.stringify(s) !== JSON.stringify(scores[0]))) throw new Error('Scores differ between clients');
  await pages[1].reload();
  await pages[1].locator('#join-menu').click();
  await pages[1].locator('#join').click();
  await pages[1].locator('#table-scores').click();
  await pages[1].locator('.scoreboard').waitFor({ timeout: 30000 });
  await expect(pages[1].locator('#chat-messages span')).toHaveText(['<b>大家好</b>', '开局了']);
  await expect(pages[1].locator('.score-row')).toContainText([/蓝色旅人/]);
  await host.locator('#next').click();
  await pages[1].locator('.hand .card').first().waitFor({ timeout: 10000 });
  if (await pages[1].locator('.hand .card').count() !== 2) throw new Error('Rejoined player did not receive round 2 hand');
  console.log(JSON.stringify({ network: '3 independent browser contexts joined over public PeerJS signaling', round: 'completed and scores synchronized', reconnect: 'same-tab guest refresh restored seat and next hand', errors }));
  if (errors.length) throw new Error('Browser errors');
} catch (error) {
  console.error(JSON.stringify({ errors, pages: await Promise.all(pages.map(p => p.locator('body').innerText().catch(() => 'unavailable'))) }));
  throw error;
} finally { await browser.close(); }
