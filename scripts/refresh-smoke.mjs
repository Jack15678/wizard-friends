import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const fixture = fs.readFileSync(new URL('./fixtures/local-peer.js', import.meta.url), 'utf8');
const peerModule = process.env.PEER_MODULE_GLOB || '**/node_modules/.vite/deps/peerjs.js*';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], contexts = [];
const session = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session') || 'null'));

async function newContext() {
  const context = await browser.newContext();
  await context.route(peerModule, route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
  contexts.push(context);
  return context;
}
async function newPage(context, name) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base);
  if (!await page.evaluate(() => globalThis.__wizardLocalPeerFixture === true)) {
    throw new Error(`PeerJS fixture did not load. Run against npm run dev or set PEER_MODULE_GLOB; current pattern: ${peerModule}`);
  }
  await page.locator('#nickname').fill(name);
  return page;
}
async function connected(page, screen) {
  await page.locator('body[data-connection="connected"]').waitFor({ timeout: 30000 });
  await page.locator(screen === 'lobby' ? '.seats' : '.table').waitFor();
}
async function position(page) {
  const saved = await session(page);
  const state = saved?.state || saved?.game;
  return {
    role: saved?.role, room: saved?.room, me: saved?.me,
    phase: state?.phase, round: state?.round, trump: state?.trump,
    seats: state?.players.map(p => p.id), scores: state?.players.map(p => p.score),
    bids: state?.players.map(p => p.bid), won: state?.players.map(p => p.won),
    hand: state?.players.find(p => p.id === saved.me)?.hand?.map(card => card.id).sort(),
    trick: state?.trick.map(play => ({ player: play.player, card: play.card.id })),
  };
}
async function samePositions(pages, expected, screen) {
  for (const [index, page] of pages.entries()) {
    await connected(page, screen);
    await expect.poll(() => position(page), { timeout: 30000 }).toEqual(expected[index]);
  }
  const saved = await session(pages[0]);
  if (saved.role === 'host') await expect.poll(async () =>
    (await session(pages[0]))?.game.players.every(player => player.online), { timeout: 30000 }).toBe(true);
}
async function chat(sender, pages, text) {
  if (!await sender.locator('#chat-input').isVisible()) await sender.locator('#chat-toggle').click();
  await sender.locator('#chat-input').fill(text);
  await sender.locator('#chat-form button').click();
  for (const page of pages) await expect(page.locator('#chat-messages span').last()).toHaveText(text, { timeout: 15000 });
  await sender.locator('#close-chat').click();
}
async function join(page, room) {
  await page.locator('#join-menu').click();
  await page.locator('#room-input').fill(room);
  await page.locator('#join').click();
  await connected(page, 'lobby');
}
async function leave(page) {
  if (await page.locator('#table-menu').count()) await page.locator('#table-menu').click();
  await page.locator('#leave').click();
  await page.locator('#create').waitFor();
  await expect.poll(() => session(page)).toBeNull();
  await page.reload();
  await page.locator('#create').waitFor();
  await expect.poll(() => session(page)).toBeNull();
  await expect(page.locator('.seats, .table')).toHaveCount(0);
}
async function finishRound(host, pages) {
  for (let step = 0; step < 160; step++) {
    if ((await session(host))?.game.phase === 'roundEnd') return;
    if (await host.locator('#next').count()) await host.locator('#next').click();
    for (const page of pages) {
      if (await page.locator('[data-trump]').count()) await page.locator('[data-trump]').first().click();
      else if (await page.locator('[data-bid]').count()) await page.locator('[data-bid]').first().click();
      else if (await page.locator('.hand .playable').count()) await page.locator('.hand .playable').first().click();
    }
    await host.waitForTimeout(50);
  }
  throw new Error('Restored multiplayer game did not finish its round');
}

try {
  const context = await newContext();
  // context.newPage() creates top-level tabs with independent sessionStorage.
  const host = await newPage(context, '刷新房主');
  const guest = await newPage(context, '刷新访客');
  const other = await newPage(context, '留在牌桌的访客');
  const pages = [host, guest, other];
  await host.locator('#create').click();
  await connected(host, 'lobby');
  const room = await host.locator('.room-code').innerText();
  await join(guest, room);
  await join(other, room);
  for (const page of pages) await expect.poll(async () => {
    const saved = await session(page);
    return (saved?.state || saved?.game)?.players.length;
  }).toBe(3);
  const tokens = await Promise.all(pages.map(page => page.evaluate(() => sessionStorage.getItem('wizard-player-token'))));
  expect(new Set(tokens).size).toBe(3);

  const lobby = await Promise.all(pages.map(position));
  await guest.reload();
  await samePositions(pages, lobby, 'lobby');
  await chat(guest, pages, '访客刷新后自动回到大厅');
  await host.reload();
  await samePositions(pages, lobby, 'lobby');
  await chat(other, pages, '房主刷新后访客自动重连');
  console.log('Refresh: guest and host automatically restored lobby, seats and connections.');

  await host.locator('#short').check();
  await host.locator('#start').click();
  for (const page of pages) await expect(page.locator('.hand .card')).toHaveCount(1);
  const inGame = await Promise.all(pages.map(position));
  await guest.reload();
  await samePositions(pages, inGame, 'game');
  await chat(guest, pages, '访客刷新后手牌与轮次保留');
  const history = await host.locator('#chat-messages span').allTextContents();
  await host.reload();
  await samePositions(pages, inGame, 'game');
  for (const page of pages) await expect(page.locator('#chat-messages span')).toHaveText(history);
  await chat(host, pages, '房主刷新后原牌局继续');
  await finishRound(host, pages);
  await host.locator('#next').click();
  for (const page of pages) await expect(page.locator('.hand .card')).toHaveCount(2);

  const roundTwo = await Promise.all(pages.map(position));
  await Promise.all(pages.map(page => page.reload()));
  await samePositions(pages, roundTwo, 'game');
  await chat(guest, pages, '三人同时刷新后仍在原牌局');
  await leave(other);
  console.log('Refresh: guest, host and simultaneous reload preserved cards and chat; next round and explicit leave passed.');
  await context.close();

  const kickContext = await newContext();
  const kickHost = await newPage(kickContext, '移除测试房主');
  const kicked = await newPage(kickContext, '被移除的访客');
  await kickHost.locator('#create').click();
  await connected(kickHost, 'lobby');
  await join(kicked, await kickHost.locator('.room-code').innerText());
  const kickedId = (await session(kicked)).me;
  await kickHost.locator(`[data-remove="${kickedId}"]`).click();
  await kicked.locator('#create').waitFor();
  await expect.poll(() => session(kicked)).toBeNull();
  await kicked.reload();
  await kicked.locator('#create').waitFor();
  expect(await session(kicked)).toBeNull();
  await expect(kicked.locator('.seats, .table')).toHaveCount(0);
  const remaining = await newPage(kickContext, '房间关闭测试访客');
  await join(remaining, await kickHost.locator('.room-code').innerText());
  await leave(kickHost);
  await remaining.locator('#create').waitFor();
  await expect.poll(() => session(remaining)).toBeNull();
  await remaining.reload();
  await remaining.locator('#create').waitFor();
  expect(await session(remaining)).toBeNull();
  await kickContext.close();

  const practiceContext = await newContext();
  const practice = await newPage(practiceContext, '练习刷新');
  await practice.locator('#practice').click();
  await connected(practice, 'lobby');
  const practiceLobby = await position(practice);
  expect(practiceLobby.role).toBe('practice');
  await practice.reload();
  await samePositions([practice], [practiceLobby], 'lobby');
  await practice.locator('#start').click();
  await expect.poll(() => practice.locator('[data-trump], [data-bid], .hand .playable').count(), { timeout: 15000 }).toBeGreaterThan(0);
  const practiceGame = await position(practice);
  await practice.reload();
  await samePositions([practice], [practiceGame], 'game');
  await leave(practice);
  console.log('Refresh: removed players stay out; practice lobby and active game resume automatically.');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ transport: 'BroadcastChannel PeerJS fixture with delayed room ID release', refresh: 'lobby, guest, host, simultaneous, practice', exit: 'guest leave, host leave and kick do not autojoin', errors }));
} catch (error) {
  const pages = contexts.filter(context => browser.contexts().includes(context)).flatMap(context => context.pages());
  console.error(JSON.stringify({ errors, pages: await Promise.all(pages.map(async page => ({
    url: page.url(), body: await page.locator('body').innerText().catch(() => 'unavailable'),
    session: await session(page).then(saved => saved ? { role: saved.role, room: saved.room, me: saved.me,
      phase: (saved.state || saved.game)?.phase, round: (saved.state || saved.game)?.round } : null).catch(() => 'unavailable'),
  }))) }));
  throw error;
} finally { await browser.close(); }
