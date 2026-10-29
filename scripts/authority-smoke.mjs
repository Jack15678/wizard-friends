import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

// Deliberately small: one real three-client round, recovery and room controls.
// Longer layout/variant matrices remain local/manual.
// This is a networking/authority check. Software WebGL on GPU-less CI runners
// can starve input handling across the clients; graphics have their own checks.
const base = process.env.GAME_URL || 'http://127.0.0.1:8787/';
const evidence = 'output/playwright';
fs.mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true,
  args: ['--disable-webgl'] });
const pages = [], errors = [];
let watcher;
const session = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session') || 'null'));
const state = async page => { const saved = await session(page); return saved?.state || saved?.game; };
async function connected(page) {
  await page.locator('body[data-connection="connected"]').waitFor({ timeout: 30000 });
}
async function position(page) {
  const saved = await session(page), view = saved?.state || saved?.game;
  return view && { phase: view.phase, round: view.round, turn: view.turn,
    trick: view.trick, options: view.options, history: view.history,
    players: view.players.map(p => ({ id: p.id, bid: p.bid, won: p.won, score: p.score, hand: p.hand })) };
}
async function chooseRules(page) {
  await page.locator('#vote-form').waitFor();
  for (const [key, value] of Object.entries({ short: true, predictionMode: 'secret', foresight: false })) {
    await page.locator(`input[name="${key}"][value="${value}"]`).check();
  }
  await page.locator('#submit-vote').click();
}
async function closeScores(page) {
  const close = page.locator('.close-scores');
  if (await close.isVisible()) await close.click();
}
async function actOnce(page) {
  if (await page.locator('[data-trump]').count()) {
    await page.locator('[data-trump]').first().click(); return true;
  }
  if (await page.locator('[data-bid]').count()) {
    await page.locator('[data-bid]').first().click(); return true;
  }
  const view = await state(page), saved = await session(page);
  if (view?.phase === 'play' && view.players[view.turn]?.id === saved.me && view.legal?.length) {
    await page.locator(`.hand [data-card="${view.legal[0]}"]`).click();
    await page.locator('#confirm-play').click(); return true;
  }
  return false;
}
try {
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext(i === 0
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }
      : { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    pages.push(page); await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#nickname').fill(['房主', '蓝巫师', '绿巫师'][i]);
  }
  let [host, guest, other] = pages;
  await host.locator('#create').click(); await connected(host);
  const room = await host.locator('.room-code').innerText();
  for (const page of [guest, other]) {
    await page.locator('#join-menu').click(); await page.locator('#room-input').fill(room);
    await page.locator('#join').click(); await connected(page);
  }
  for (const page of pages) await expect.poll(async () => (await state(page))?.players.length).toBe(3);
  await host.locator('#begin-vote').click();
  for (const page of pages) await chooseRules(page);
  await host.locator('#start').click();
  for (const page of pages) await page.locator('.table').waitFor();
  // Authority secrets must never enter even the host browser cache.
  for (const page of pages) {
    const saved = await session(page), view = saved.state;
    expect(saved.game).toBeUndefined();
    expect(view.randomState).toBeUndefined(); expect(view.identities).toBeUndefined();
    expect(view.players.filter(p => Array.isArray(p.hand))).toHaveLength(1);
  }
  for (let i = 0; i < 6 && (await state(host)).phase !== 'play'; i++) {
    for (const page of pages) await actOnce(page);
    await host.waitForTimeout(80);
  }
  await expect.poll(async () => (await state(host)).phase).toBe('play');
  for (const page of pages) {
    const saved = await session(page);
    expect(saved.state.players.filter(p => p.id !== saved.me).every(p => p.bid == null)).toBe(true);
  }
  const watcherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  watcher = await watcherContext.newPage(); watcher.on('dialog', dialog => dialog.accept());
  watcher.on('pageerror', error => errors.push(error.message));
  await watcher.goto(`${base}?room=${room}&watch=1`); await connected(watcher);
  await expect.poll(async () => (await state(watcher))?.spectator).toBe(true);
  const publicState = await state(watcher);
  expect(publicState.players.every(p => p.hand === undefined && p.bid == null)).toBe(true);
  expect(publicState.randomState).toBeUndefined();
  await expect(watcher.locator('.hand [data-card], [data-bid]')).toHaveCount(0);
  await host.waitForTimeout(1200);
  const beforePause = await Promise.all(pages.map(position));
  await host.locator('#room-pause').click();
  await expect.poll(async () => (await state(guest))?.lifecycle?.paused).toBe(true);
  const paused = await state(guest);
  await host.waitForTimeout(1100);
  expect(await Promise.all(pages.map(position))).toEqual(beforePause);
  await guest.locator('#chat-toggle').click();
  await guest.locator('#chat-input').fill('暂停期间仍可聊天');
  await guest.locator('#chat-form button').click();
  await expect(host.locator('#chat-messages span').last()).toHaveText('暂停期间仍可聊天');
  await guest.locator('#close-chat').click();
  // Really close the host tab. A fresh tab explicitly claims the same browser's
  // room-scoped return handle; merely toggling network emulation can leave WS alive.
  const hostContext = host.context(); await host.close();
  await expect.poll(async () => (await state(guest))?.lifecycle?.hostOffline).toBe(true);
  await connected(guest); expect((await state(guest)).lifecycle.paused).toBe(true);
  host = await hostContext.newPage(); pages[0] = host; host.setDefaultTimeout(15000);
  host.on('pageerror', error => errors.push(error.message));
  host.on('dialog', dialog => dialog.accept());
  await host.goto(base); await host.locator('#resume-room').click(); await connected(host);
  await expect.poll(async () => (await state(guest))?.lifecycle?.hostOffline).toBe(false);
  await expect.poll(async () => (await state(host))?.lifecycle?.paused).toBe(true);
  await host.locator('#room-pause').click();
  await expect.poll(async () => (await state(guest))?.lifecycle?.paused).toBe(false);
  const remaining = (await state(guest)).turnDeadline - Date.now();
  expect(remaining).toBeLessThanOrEqual(paused.lifecycle.remainingMs + 500);
  expect(remaining).toBeGreaterThan(paused.lifecycle.remainingMs - 1500);
  // An actual refresh must recover the same round, cards and score.
  const beforeReload = await position(host); await host.reload(); await connected(host);
  await expect.poll(() => position(host)).toEqual(beforeReload);
  for (let step = 0; step < 25 && (await state(host)).phase !== 'roundEnd'; step++) {
    for (const page of pages) await actOnce(page);
    await host.waitForTimeout(100);
  }
  await expect.poll(async () => (await state(host)).phase).toBe('roundEnd');
  const results = (await state(host)).history;
  for (const page of pages) {
    await expect.poll(async () => (await state(page)).history).toEqual(results);
    await page.locator('.personal-result').waitFor();
    await closeScores(page);
  }
  await host.screenshot({ path: `${evidence}/smoke-mobile-result.png` });
  await guest.screenshot({ path: `${evidence}/smoke-desktop-result.png` });
  await host.locator('#room-dissolve').click();
  for (const page of pages) await page.locator('#create').waitFor();
  await watcher.locator('#create').waitFor();
  // Closed rooms remain tombstoned and cannot be revived with their old link.
  if (!await guest.locator('#room-input').isVisible()) await guest.locator('#join-menu').click();
  await guest.locator('#room-input').fill(room);
  await guest.locator('#join').click();
  await expect(guest.locator('#notice')).toContainText(/关闭|解散/);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ clients: 3, graphics: '2D', transport: 'local Durable Objects + WebSockets',
    verified: ['secret-bid privacy', 'host cache privacy', 'read-only spectator privacy', 'pause freezes gameplay', 'chat while paused',
      'host tab close and explicit new-tab return', 'resume remaining deadline', 'host refresh', 'round scores synchronized', 'dissolve tombstone'], errors }));
} catch (error) {
  for (const [i, page] of pages.entries()) await page.screenshot({ path: `${evidence}/failure-${i}.png` }).catch(() => {});
  console.error(JSON.stringify({ errors, pages: await Promise.all(pages.map(async page => ({
    body: await page.locator('body').innerText().catch(() => ''),
    position: await position(page).catch(() => null) }))) }));
  throw error;
} finally { await browser.close(); }
