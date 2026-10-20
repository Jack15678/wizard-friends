import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
fs.mkdirSync('.local', { recursive: true });
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [], errors = [];
const savedSession = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session') || 'null'));
async function position(page) {
  const saved = await savedSession(page);
  const state = saved?.state || saved?.game;
  return {
    room: saved?.room, me: saved?.me, phase: state?.phase, round: state?.round,
    seats: state?.players.map(p => p.id), scores: state?.players.map(p => p.score),
    hand: state?.players.find(p => p.id === saved.me)?.hand?.map(c => c.id).sort(),
  };
}
async function connected(page) {
  await page.locator('body[data-connection="connected"]').waitFor({ timeout: 90000 });
  await page.locator('.table').waitFor({ timeout: 90000 });
}
async function finishRound(host) {
  for (let step = 0; step < 160; step++) {
    if ((await savedSession(host))?.game.phase === 'roundEnd') return;
    if (await host.locator('#next').count()) await host.locator('#next').click();
    for (const page of pages) {
      if (await page.locator('[data-trump]').count()) await page.locator('[data-trump]').first().click();
      else if (await page.locator('[data-bid]').count()) await page.locator('[data-bid]').first().click();
      else if (await page.locator('.hand .playable').count()) await page.locator('.hand .playable').first().click();
    }
    await host.waitForTimeout(100);
  }
  throw new Error('Round did not complete');
}
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
  await pages[1].locator('#quick-settings > summary').click();
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
  await host.locator('#quick-settings > summary').click();
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
  // Resolve prediction, then let a real 30-second turn expire on the host.
  for (let step = 0; step < 20 && !await host.locator('#turn-countdown').count(); step++) {
    for (const p of pages) {
      if (await p.locator('button[data-trump]').count()) await p.locator('button[data-trump]').first().click();
      else if (await p.locator('[data-bid]').count()) await p.locator('[data-bid]').first().click();
    }
    await host.waitForTimeout(100);
  }
  for (const p of pages) await expect(p.locator('#turn-countdown')).toBeVisible();
  const remaining = await Promise.all(pages.map(p => p.locator('#turn-countdown').innerText()));
  if (Math.max(...remaining.map(x => parseInt(x))) - Math.min(...remaining.map(x => parseInt(x))) > 1) throw new Error('Countdowns are not synchronized');
  await expect(host.locator('.played')).toHaveCount(1, { timeout: 35000 });
  for (const p of pages) await expect(p.locator('.played')).toHaveCount(1);
  console.log('30-second expiry automatically played one legal card across all clients');
  await finishRound(host);
  for (const p of pages) {
    await p.locator('#table-scores').click();
    await p.locator('.round-results').waitFor();
  }
  const scores = await Promise.all(pages.map(p => p.locator('.score-row b').allTextContents()));
  if (scores.some(s => JSON.stringify(s) !== JSON.stringify(scores[0]))) throw new Error('Scores differ between clients');
  const guestPosition = await position(pages[1]);
  await pages[1].reload();
  await connected(pages[1]);
  await expect.poll(() => position(pages[1]), { timeout: 90000 }).toEqual(guestPosition);
  await pages[1].locator('#table-scores').click();
  await pages[1].locator('.scoreboard').waitFor({ timeout: 30000 });
  await expect(pages[1].locator('#chat-messages span')).toHaveText(['<b>大家好</b>', '开局了']);
  await expect(pages[1].locator('.score-row')).toContainText([/蓝色旅人/]);
  await host.locator('#next').click();
  for (const page of pages) await expect(page.locator('.hand .card')).toHaveCount(2, { timeout: 15000 });
  const beforeHostRefresh = await Promise.all(pages.map(position));
  await host.reload();
  for (const page of pages) await connected(page);
  await expect.poll(async () => (await savedSession(host))?.game.players.every(p => p.online), { timeout: 90000 }).toBe(true);
  for (const [index, page] of pages.entries()) {
    await expect.poll(() => position(page), { timeout: 90000 }).toEqual(beforeHostRefresh[index]);
    await expect(page.locator('#chat-messages span')).toHaveText(['<b>大家好</b>', '开局了']);
  }
  await finishRound(host);
  await host.locator('#next').click();
  for (const page of pages) await expect(page.locator('.hand .card')).toHaveCount(3, { timeout: 15000 });
  console.log(JSON.stringify({ network: '3 independent browser contexts joined over public PeerJS signaling', round: 'two rounds completed with synchronized scores', reconnect: 'guest refresh and host refresh automatically restored room, seats, round, chat and hands; unchanged guest pages continued to round 3', errors }));
  if (errors.length) throw new Error('Browser errors');
} catch (error) {
  console.error(JSON.stringify({ errors, pages: await Promise.all(pages.map(p => p.locator('body').innerText().catch(() => 'unavailable'))) }));
  throw error;
} finally { await browser.close(); }
