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
    bids: state?.players.map(p => p.bid), options: state?.options,
    voteTargetRound: state?.vote?.targetRound, votePending: state?.vote?.pending,
  };
}
async function submitRoundRules(page, choices) {
  for (const [key, value] of Object.entries(choices)) await page.locator(`input[name="${key}"][value="${value}"]`).check();
  await page.locator('#submit-vote').click();
}
async function connected(page, screen = 'game') {
  await page.locator('body[data-connection="connected"]').waitFor({ timeout: 90000 });
  await page.locator(({ lobby: '.seats', rules: '.rules-vote', game: '.table' })[screen]).waitFor({ timeout: 90000 });
}
async function next(host) {
  if (await host.locator('.close-scores').isVisible()) await host.locator('.close-scores').click();
  await host.locator('#next').click();
}
async function finishRound(host) {
  for (let step = 0; step < 160; step++) {
    if ((await savedSession(host))?.game.phase === 'roundEnd') return;
    if (await host.locator('#next').count()) await next(host);
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
    const context = await browser.newContext(i === 0 ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
    await context.addInitScript(() => { globalThis.RTCPeerConnection = class { constructor() { throw new Error('WebRTC must not be used'); } }; });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    pages.push(page);
    await page.goto(base);
    await page.locator('#nickname').fill(['房主', '蓝巫师', '绿巫师'][i]);
  }
  const host = pages[0];
  await host.locator('#create').click();
  await connected(host, 'lobby');
  const room = await host.locator('.room-code').innerText();
  console.log('Mobile host connected to the Cloudflare WebSocket relay');
  for (const p of pages.slice(1)) {
    await p.locator('#join-menu').click();
    await p.locator('#room-input').fill(room);
    await p.locator('#join').click();
    await connected(p, 'lobby');
  }
  await pages[1].locator('#quick-settings > summary').click();
  await pages[1].locator('#rename-toggle').click();
  await pages[1].locator('#rename-input').fill('蓝色旅人');
  await pages[1].locator('#rename-form button[type=submit]').click();
  for (const p of pages) await expect(p.locator('.seat-name b')).toContainText(['房主', '蓝色旅人', '绿巫师']);
  await pages[1].locator('#rename-toggle').click();
  await pages[1].locator('#rename-input').fill('房主');
  await pages[1].locator('#rename-form button[type=submit]').click();
  await expect(pages[1].locator('#notice')).toContainText('昵称已被使用');
  for (const p of pages) await expect(p.locator('.seat-name b')).toContainText(['房主', '蓝色旅人', '绿巫师']);
  await pages[1].keyboard.press('Escape');
  await pages[1].locator('#chat-toggle').click();
  await pages[1].locator('#chat-input').fill('<b>大家好</b>');
  await pages[1].locator('#chat-form button').click();
  for (const p of pages) {
    await expect(p.locator('#chat-messages span')).toHaveText(['<b>大家好</b>']);
    await expect(p.locator('#chat-messages span b')).toHaveCount(0);
  }
  await pages[2].locator('#chat-toggle').click();
  await pages[2].locator('#chat-input').fill('保留输入草稿');
  await host.locator('#begin-vote').click();
  for (const p of pages) await p.locator('#vote-form').waitFor();
  await expect(pages[2].locator('#chat-input')).toHaveValue('保留输入草稿');
  await expect(pages[2].locator('#chat-input')).toBeFocused();
  for (const p of pages.slice(1)) await p.locator('#close-chat').click();
  // One vote for each prediction mode forces a real tie while other categories resolve.
  for (const [i, p] of pages.entries()) {
    await p.locator(`input[name="predictionMode"][value="${['public', 'hidden', 'secret'][i]}"]`).check();
    await p.locator('input[name="short"][value="true"]').check();
    await p.locator('input[name="foresight"][value="true"]').check();
    await p.locator('#submit-vote').click();
    if (i < 2) await expect(host.locator('.vote-count')).toContainText(`${i + 1} / 3`);
  }
  for (const p of pages) {
    await expect(p.locator('#vote-title')).toContainText('平票');
    await expect(p.locator('.vote-groups fieldset')).toHaveCount(1);
    await expect(p.locator('.resolved-rules')).toContainText('标准牌库');
  }
  await pages[1].reload();
  await connected(pages[1], 'rules');
  await expect(pages[1].locator('#vote-title')).toContainText('平票', { timeout: 30000 });
  for (const p of pages) {
    await p.locator('input[name="predictionMode"][value="hidden"]').check();
    await p.locator('#submit-vote').click();
  }
  for (const p of pages) await expect(p.locator('.vote-result')).toContainText('隐藏预估');
  await host.locator('#start').click();
  for (const p of pages) {
    await expect(p.locator('.concealed-hand')).toBeVisible();
    await expect(p.locator('.foresight-player')).toHaveCount(2);
    await expect(p.locator('.hand .card')).toHaveCount(0);
  }
  for (const p of pages) if (await p.locator('button[data-trump]').count()) await p.locator('button[data-trump]').first().click();
  for (const [i, p] of pages.entries()) {
    await p.locator('[data-bid="0"]').click();
    if (i < 2) await expect(pages[2].locator('.prediction').filter({ hasText: '已锁定' })).toHaveCount(i + 1);
  }
  for (const p of pages) {
    await expect(p.locator('.foresight-hands')).toHaveCount(0);
    await expect(p.locator('.hand .card')).toHaveCount(1);
    await expect(p.locator('.prediction').filter({ hasText: '已锁定' })).toHaveCount(0);
  }
  await host.locator('#chat-toggle').click();
  await host.locator('#chat-input').fill('开局了');
  await host.locator('#chat-form button').click();
  for (const p of pages) await expect(p.locator('#chat-messages span').last()).toHaveText('开局了');
  await host.screenshot({ path: '.local/network-chat-game.png', fullPage: true });
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
  const firstRoundScores = (await savedSession(host)).game.players.map(player => player.score);
  await next(host);
  for (const page of pages) {
    await connected(page, 'rules');
    await expect(page.locator('.vote-groups fieldset')).toHaveCount(3);
    await expect(page.locator('input[name="deckMode"], input[name="short"]')).toHaveCount(0);
    await expect.poll(() => position(page)).toMatchObject({ scores: firstRoundScores, voteTargetRound: 2 });
  }
  const secondRoundChoices = { predictionMode: 'secret', strict: 'true', foresight: 'true' };
  await submitRoundRules(pages[1], secondRoundChoices);
  await expect(host.locator('.vote-count')).toContainText('1 / 3');
  const secondRoundVote = await position(pages[1]);
  await pages[1].reload();
  await connected(pages[1], 'rules');
  await expect.poll(() => position(pages[1]), { timeout: 90000 }).toEqual(secondRoundVote);
  await expect(pages[1].locator('#submit-vote')).toBeDisabled();
  await expect(pages[1].locator('input[name="predictionMode"][value="secret"]')).toBeChecked();
  for (const page of [host, pages[2]]) await submitRoundRules(page, secondRoundChoices);
  for (const page of pages) {
    await expect(page.locator('.vote-result')).toContainText('秘密数字 · 先见之明');
    await expect(page.locator('.vote-result')).not.toContainText('加减预估');
  }
  await host.locator('#start').click();
  for (const page of pages) {
    await expect(page.locator('.concealed-hand')).toContainText('2 张手牌暂时保密');
    await expect(page.locator('.hand .card')).toHaveCount(0);
    await expect(page.locator('.foresight-hands .card')).toHaveCount(4);
    await expect.poll(() => position(page)).toMatchObject({ scores: firstRoundScores,
      options: { deckMode: 'standard', short: true, predictionMode: 'secret', strict: false, foresight: true } });
  }
  for (const page of pages) if (await page.locator('button[data-trump]').count()) await page.locator('button[data-trump]').first().click();
  await pages[1].locator('[data-bid="0"]').click();
  const bidder = (await savedSession(pages[1])).me;
  await expect.poll(async () => {
    const saved = await savedSession(pages[2]);
    const ownPlayer = saved.state.players.find(player => player.id === saved.me);
    const otherPlayer = saved.state.players.find(player => player.id === bidder);
    return { bid: otherPlayer.bid, submitted: otherPlayer.bidSubmitted, ownHandExposed: Object.hasOwn(ownPlayer, 'hand') };
  }).toEqual({ bid: null, submitted: true, ownHandExposed: false });
  await expect(pages[2].locator('.prediction').filter({ hasText: '已锁定' })).toHaveCount(1);
  const beforeHostRefresh = await Promise.all(pages.map(position));
  await host.reload();
  for (const page of pages) await connected(page);
  await expect.poll(async () => (await savedSession(host))?.game.players.every(p => p.online), { timeout: 90000 }).toBe(true);
  for (const [index, page] of pages.entries()) {
    await expect.poll(() => position(page), { timeout: 90000 }).toEqual(beforeHostRefresh[index]);
    await expect(page.locator('#chat-messages span')).toHaveText(['<b>大家好</b>', '开局了']);
    await expect(page.locator('.concealed-hand')).toBeVisible();
  }
  await expect(pages[2].locator('.prediction').filter({ hasText: '已锁定' })).toHaveCount(1);
  expect((await savedSession(pages[2])).state.players.find(player => player.id === bidder).bid).toBeNull();
  await finishRound(host);
  for (const page of pages) await expect(page.locator('.prediction').filter({ hasText: '已锁定' })).toHaveCount(0);
  await next(host);
  for (const page of pages) await submitRoundRules(page, { predictionMode: 'public', strict: 'false', foresight: 'false' });
  await host.locator('#start').click();
  for (const page of pages) await expect(page.locator('.hand .card')).toHaveCount(3, { timeout: 15000 });
  const beforeNetworkLoss = await Promise.all(pages.map(position));
  await host.context().setOffline(true);
  await host.waitForTimeout(500);
  await host.context().setOffline(false);
  for (const [index, page] of pages.entries()) {
    await connected(page);
    await expect.poll(() => position(page), { timeout: 30000 }).toEqual(beforeNetworkLoss[index]);
  }
  await host.screenshot({ path: '.local/relay-mobile-host.png', fullPage: true });
  console.log(JSON.stringify({ network: '3 independent browser contexts over WebSocket; mobile host; WebRTC disabled',
    vote: 'category tie; each round revotes only three options; fixed deck/length; round 2 changes hidden to secret',
    privacy: 'foresight enabled in rounds 1 and 2; hidden/secret predictions reveal at correct boundaries',
    names: 'duplicate manual rename rejected on all clients', timer: '30-second expiry played one legal card',
    round: 'two rounds completed with synchronized scores',
    reconnect: 'submitted round-2 vote and secret bid retained across guest/host refresh, scores and privacy preserved; round 3 survived mobile host offline/online', errors }));
  if (errors.length) throw new Error('Browser errors');
} catch (error) {
  console.error(JSON.stringify({ errors, pages: await Promise.all(pages.map(p => p.locator('body').innerText().catch(() => 'unavailable'))) }));
  throw error;
} finally { await browser.close(); }
