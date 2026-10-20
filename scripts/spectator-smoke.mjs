import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const realPeer = process.env.REAL_PEER === '1';
const mode = realPeer ? 'real PeerJS/WebRTC' : 'local BroadcastChannel PeerJS fixture';
const timeout = realPeer ? 60000 : 30000;
const check = expect.configure({ timeout });
const peerModule = process.env.PEER_MODULE_GLOB || '**/node_modules/.vite/deps/peerjs.js*';
const errors = [], pages = [];
fs.mkdirSync('.local', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const session = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session') || 'null'));
const game = async page => (await session(page))?.game;
const publicState = async page => (await session(page))?.state;
const roomRow = (page, room) => page.locator(`.room-directory-item[data-room="${room}"]`);

async function newPage(context, name) {
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base);
  if (!realPeer) check(await page.evaluate(() => globalThis.__wizardLocalPeerFixture === true)).toBe(true);
  await page.locator('#nickname').fill(name);
  return page;
}
async function connected(page, spectator = false) {
  await check(page.locator(`body[data-connection="connected"][data-spectator="${spectator}"]`)).toBeVisible();
}
async function visibleDirectory(page) {
  await check(page.locator('#room-directory')).toBeVisible();
  await check(page.locator('#room-directory')).toHaveAttribute('data-status', 'ready');
  await check(page.locator('.home-room-list #room-directory')).toHaveCount(1);
  await check(page.locator('#watch-menu')).toHaveCount(0);
}
async function identity(page) {
  const saved = await session(page), state = saved?.state || saved?.game;
  return {
    role: saved?.role, room: saved?.room, me: saved?.me,
    phase: state?.phase, round: state?.round,
    seats: state?.players.map(player => player.id), names: state?.players.map(player => player.name),
    bids: state?.players.map(player => player.bid), scores: state?.players.map(player => player.score),
    chat: state?.chat?.map(message => ({ name: message.name, text: message.text })),
    history: state?.history, options: state?.options, vote: state?.vote,
    log: state?.log, publicEvents: state?.publicEvents,
  };
}
async function assertPublicSnapshot(page, { secret = true, eventsAfter = 0 } = {}) {
  const saved = await session(page), state = saved?.state;
  check(saved?.role).toBe('spectator');
  check(saved).not.toHaveProperty('game');
  check(saved).not.toHaveProperty('identities');
  check(state?.spectator).toBe(true);
  check(state?.players).toHaveLength(3);
  check(state?.players.some(player => player.id === saved.me)).toBe(false);
  for (const player of state.players) {
    check(player).not.toHaveProperty('hand');
    if (secret) check(player.bid).toBeNull();
  }
  check(state.foresightActive).toBe(false);
  check(state.canBid).toBe(false);
  check(state.legal).toEqual([]);
  check(state.bids).toEqual([]);
  check(state.vote?.ownChoices ?? null).toBeNull();
  if (secret) for (const event of (state.publicEvents || []).filter(event => event.seq > eventsAfter)) {
    check(event.text).not.toMatch(/预[估言]\s*\d+\s*墩/);
  }
}
async function assertReadOnlyUI(page) {
  await check(page.locator('[data-card], [data-bid], [data-trump], #vote-form, #submit-vote, #begin-vote, #addbot, [data-remove], #next, #rematch, #rename-toggle')).toHaveCount(0);
  await check(page.locator('.hand-section, .foresight-hands')).toHaveCount(0);
  await check(page.locator('#chat-form')).not.toBeVisible();
  await check(page.locator('#chat-input')).toBeDisabled();
  await check(page.locator('.spectator-banner')).toContainText('观战中 · 仅公开信息');
}
async function sendChat(page, text) {
  if (!await page.locator('#chat-input').isVisible()) await page.locator('#chat-toggle').click();
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-form button').click();
  await check(page.locator('#chat-messages span').last()).toHaveText(text);
  await page.locator('#close-chat').click();
}
async function finishFirstRound(host) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = await game(host);
    if (current?.phase === 'roundEnd') return;
    if (await host.locator('[data-trump]').count()) await host.locator('[data-trump]').first().click();
    else if (await host.locator('[data-bid]').count()) await host.locator('[data-bid]').first().click();
    else if (await host.locator('.hand .playable').count()) await host.locator('.hand .playable').first().click();
    else if (current?.phase === 'trickEnd') await host.locator('#next').click();
    else await host.waitForTimeout(100);
  }
  throw new Error('Host and two bots did not finish the first round');
}
async function leave(page) {
  if (await page.locator('#table-menu').count()) {
    if (!await page.locator('#table-menu-panel').isVisible()) await page.locator('#table-menu').click();
  } else if (!await page.locator('#leave').isVisible()) await page.locator('#quick-settings summary').click();
  await page.locator('#leave').click();
  await check(page.locator('#create')).toBeVisible();
  await check.poll(() => session(page)).toBeNull();
}

// Use a separate raw data connection to prove that authority does not depend on
// disabled UI controls. The protocol must reject actions after a watch handshake.
async function rejectForgedActions(page, room) {
  const moduleURL = process.env.PEER_MODULE_URL || await page.evaluate(() =>
    performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => /\/node_modules\/\.vite\/deps\/peerjs\.js(?:\?|$)/.test(url)));
  if (!moduleURL) throw new Error('Raw spectator check requires Vite dev or PEER_MODULE_URL pointing to its PeerJS module');
  return page.evaluate(async ({ moduleURL, room, timeout }) => {
    const { default: Peer } = await import(moduleURL);
    return new Promise((resolve, reject) => {
      const peer = new Peer(), rejections = [];
      let connection, sent = false, done = false;
      const finish = (error) => {
        if (done) return;
        done = true; clearTimeout(timer);
        try { connection?.close(); peer.destroy(); } catch {}
        if (error) reject(error); else resolve(rejections);
      };
      const timer = setTimeout(() => finish(new Error('Raw spectator handshake or rejection timed out')), timeout);
      peer.on('error', error => finish(new Error(`Raw spectator Peer error: ${error.type}`)));
      peer.on('open', () => {
        connection = peer.connect(`wizard-friends-${room}`, { reliable: true });
        connection.on('error', error => finish(error));
        connection.on('open', () => connection.send({ type: 'watch', token: crypto.randomUUID() }));
        connection.on('data', message => {
          if (message?.type === 'state') {
            if (message.state?.spectator !== true || message.state.players.some(player => Object.hasOwn(player, 'hand'))) {
              return finish(new Error('Raw spectator received a private player hand'));
            }
            if (!sent) {
              sent = true;
              for (const action of [
                { type: 'rename', name: '伪造的玩家改名' },
                { type: 'chat', text: '伪造的观众消息' },
                { type: 'next' },
              ]) connection.send({ type: 'action', action, actor: message.state.players[0].id });
            }
          } else if (message?.type === 'error') {
            rejections.push(message.message);
            if (rejections.length === 3) finish();
          }
        });
      });
    });
  }, { moduleURL, room, timeout });
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (!realPeer) {
    const fixture = fs.readFileSync(new URL('./fixtures/local-peer.js', import.meta.url), 'utf8');
    await context.route(peerModule, route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
  }
  console.log(JSON.stringify({ mode, timeout, base }));
  // Keep the directory's coordinator alive while the host refreshes its tab.
  // Top-level context.newPage() tabs have independent sessionStorage identities.
  const directory = await newPage(context, '目录查看者');
  const watcher = await newPage(context, '独立观众');
  const host = await newPage(context, '观战测试房主');
  await visibleDirectory(directory);
  await host.locator('#create').click();
  await connected(host);
  await check(host.locator('.seats')).toBeVisible();
  await host.locator('#addbot').click();
  await host.locator('#addbot').click();
  await check.poll(async () => (await game(host))?.players.length).toBe(3);
  const room = (await session(host)).room;
  await check(roomRow(directory, room)).toHaveCount(0);
  if (!realPeer) await check(directory.locator('.room-directory-empty')).toBeVisible();
  await sendChat(host, '这条公开聊天可以被观众查看');
  await host.locator('#begin-vote').click();
  await host.locator('input[name="deckMode"][value="standard"]').check();
  await host.locator('input[name="predictionMode"][value="secret"]').check();
  await host.locator('input[name="strict"][value="false"]').check();
  await host.locator('input[name="foresight"][value="true"]').check();
  await host.locator('input[name="short"][value="true"]').check();
  await host.locator('#submit-vote').click();
  await check(host.locator('#start')).toBeVisible();
  await check(roomRow(directory, room)).toHaveCount(0);
  await host.locator('#start').click();
  await check(roomRow(directory, room)).toBeVisible();
  await check(roomRow(directory, room)).toContainText('观战测试房主');
  await check(roomRow(directory, room)).toContainText('3 人牌局');
  await check(roomRow(directory, room)).toContainText('第 1 / 5 轮');
  await directory.screenshot({ path: `.local/home-rooms-${realPeer ? 'real' : 'fixture'}-desktop.png`, fullPage: true });
  await roomRow(directory, room).locator('.room-directory-watch').focus();

  await watcher.setViewportSize({ width: 390, height: 844 });
  await visibleDirectory(watcher);
  await check(roomRow(watcher, room)).toBeVisible();
  await check.poll(() => watcher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await watcher.screenshot({ path: `.local/home-rooms-${realPeer ? 'real' : 'fixture'}-mobile.png`, fullPage: true });
  await roomRow(watcher, room).locator('.room-directory-watch').click();
  await connected(watcher, true);
  await check(watcher.locator('.table')).toBeVisible();
  await assertPublicSnapshot(watcher);
  await assertReadOnlyUI(watcher);
  await check.poll(async () => (await game(host))?.players.length).toBe(3);
  await check.poll(async () => (await publicState(watcher))?.spectatorCount).toBe(1);
  await check(roomRow(directory, room)).toContainText('1 人观战');
  await check(roomRow(directory, room).locator('.room-directory-watch')).toBeFocused();
  await watcher.locator('#chat-toggle').click();
  await check(watcher.locator('#chat-messages span')).toHaveText(['这条公开聊天可以被观众查看']);
  await check(watcher.locator('#chat-form')).not.toBeVisible();
  await watcher.locator('#close-chat').click();

  if (await host.locator('[data-trump]').count()) await host.locator('[data-trump]').first().click();
  await check(host.locator('[data-bid]').first()).toBeVisible();
  await host.locator('[data-bid]').first().click();
  await check.poll(async () => (await game(host))?.phase).toBe('play');
  await check.poll(async () => (await publicState(watcher))?.phase).toBe('play');
  await assertPublicSnapshot(watcher);
  await finishFirstRound(host);
  await check.poll(async () => (await publicState(watcher))?.phase).toBe('roundEnd');
  await assertPublicSnapshot(watcher, { secret: false });
  const firstRound = await game(host);
  const watcherRound = await publicState(watcher);
  check(watcherRound.players.map(player => player.bid)).toEqual(firstRound.players.map(player => player.bid));
  check(watcherRound.players.map(player => player.score)).toEqual(firstRound.players.map(player => player.score));
  check(watcherRound.history).toEqual(firstRound.history);
  const events = watcher.locator('.spectator-activity ol > li');
  for (const player of firstRound.players) await check.poll(async () =>
    (await events.allTextContents()).some(line => line.includes(player.name) && line.includes('出牌'))).toBe(true);
  await check.poll(async () => (await events.allTextContents()).some(line =>
    line.includes(firstRound.players[firstRound.lastWinner].name) && /赢下|赢得/.test(line))).toBe(true);
  await check.poll(async () => (await events.allTextContents()).some(line => line.includes('第 1 轮结算'))).toBe(true);

  const beforeForgery = await identity(host);
  const rejections = await rejectForgedActions(directory, room);
  check(rejections).toHaveLength(3);
  for (const rejection of rejections) check(rejection).toMatch(/观众不能执行玩家操作/);
  check(await identity(host)).toEqual(beforeForgery);
  await check.poll(async () => (await publicState(watcher))?.spectatorCount).toBe(1);

  await watcher.setViewportSize({ width: 390, height: 844 });
  await check.poll(() => watcher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await watcher.evaluate(() => ['.action-panel', '.spectator-activity', '.spectator-banner'].map(selector => {
    const rectangle = document.querySelector(selector).getBoundingClientRect();
    return { left: rectangle.left, right: rectangle.right, top: rectangle.top, bottom: rectangle.bottom };
  }));
  for (const rectangle of bounds) { check(rectangle.left).toBeGreaterThanOrEqual(0); check(rectangle.right).toBeLessThanOrEqual(390); }
  check(bounds[0].bottom).toBeLessThanOrEqual(bounds[1].top);
  check(bounds[1].bottom).toBeLessThanOrEqual(bounds[2].top);
  await watcher.screenshot({ path: `.local/spectator-${realPeer ? 'real' : 'fixture'}-mobile.png`, fullPage: true });

  const beforeRefresh = await identity(watcher);
  await watcher.reload();
  await connected(watcher, true);
  await check.poll(() => identity(watcher)).toEqual(beforeRefresh);
  await assertPublicSnapshot(watcher, { secret: false });
  await host.reload();
  await connected(host);
  await connected(watcher, true);
  await sendChat(host, '房主刷新后观战仍可继续');
  await check(watcher.locator('#chat-messages span').last()).toHaveText('房主刷新后观战仍可继续');
  check((await session(watcher)).me).toBe(beforeRefresh.me);
  check((await session(watcher)).room).toBe(room);
  await host.locator('#next').click();
  await check.poll(async () => (await publicState(watcher))?.phase).toBe('rules');
  await check(roomRow(directory, room)).toHaveCount(0);
  if (!realPeer) await check(directory.locator('.room-directory-empty')).toBeVisible();
  await check(watcher.locator('.rules-vote')).toContainText('玩家正在选择第 2 轮规则');
  await assertReadOnlyUI(watcher);
  await assertPublicSnapshot(watcher, { secret: false });
  const settledFields = {
    bids: firstRound.players.map(player => player.bid),
    scores: firstRound.players.map(player => player.score),
    history: firstRound.history,
    options: firstRound.options,
  };
  const settledSnapshot = async () => {
    const state = await publicState(watcher);
    return { bids: state.players.map(player => player.bid), scores: state.players.map(player => player.score),
      history: state.history, options: state.options };
  };
  await check.poll(settledSnapshot).toEqual(settledFields);
  const publicVote = (await publicState(watcher)).vote;
  check(publicVote?.ownChoices ?? null).toBeNull();
  check(publicVote).not.toHaveProperty('ballots');
  const waitingSnapshot = await identity(watcher);
  await watcher.reload();
  await connected(watcher, true);
  await check.poll(() => identity(watcher)).toEqual(waitingSnapshot);
  await check.poll(settledSnapshot).toEqual(settledFields);
  await assertReadOnlyUI(watcher);
  const settingsToggle = watcher.locator('#quick-settings summary');
  await check(settingsToggle).toBeVisible();
  const settingsBounds = await settingsToggle.boundingBox();
  const bannerBounds = await watcher.locator('.spectator-banner').boundingBox();
  check(settingsBounds.y + settingsBounds.height).toBeLessThanOrEqual(bannerBounds.y);
  await settingsToggle.click();
  await check(watcher.locator('#leave')).toBeVisible();
  await settingsToggle.click();
  await check(watcher.locator('#leave')).not.toBeVisible();
  await watcher.screenshot({ path: `.local/spectator-${realPeer ? 'real' : 'fixture'}-round2-vote-mobile.png`, fullPage: true });

  await check(host.locator('.vote-groups fieldset')).toHaveCount(3);
  await check(host.locator('input[name="deckMode"], input[name="short"]')).toHaveCount(0);
  await host.locator('input[name="predictionMode"][value="secret"]').check();
  await host.locator('input[name="strict"][value="false"]').check();
  await host.locator('input[name="foresight"][value="true"]').check();
  await host.locator('#submit-vote').click();
  await check(host.locator('#start')).toBeVisible();
  await check.poll(settledSnapshot).toEqual(settledFields);
  const previousEventSeq = (await publicState(watcher)).publicEvents?.at(-1)?.seq || 0;
  await host.locator('#start').click();
  await check.poll(async () => (await publicState(watcher))?.round).toBe(2);
  await check(roomRow(directory, room)).toBeVisible();
  await check(roomRow(directory, room)).toContainText('第 2 / 5 轮');
  await check(host.locator('.concealed-hand')).toContainText('2 张手牌暂时保密');
  await check(host.locator('.foresight-hands .card')).toHaveCount(4);
  if (await host.locator('[data-trump]').count()) await host.locator('[data-trump]').first().click();
  await check.poll(async () => (await publicState(watcher))?.players.filter(player => player.bot && player.bidSubmitted).length).toBe(2);
  await assertPublicSnapshot(watcher, { eventsAfter: previousEventSeq });
  await assertReadOnlyUI(watcher);
  check((await publicState(watcher)).players.map(player => player.score)).toEqual(settledFields.scores);
  await watcher.screenshot({ path: `.local/spectator-${realPeer ? 'real' : 'fixture'}-round2-secret-mobile.png`, fullPage: true });
  const seatsBeforeExit = (await game(host)).players.map(player => ({ id: player.id, online: player.online }));
  await leave(watcher);
  await visibleDirectory(watcher);
  await check(roomRow(watcher, room)).toBeVisible();
  await check.poll(async () => (await game(host))?.players.map(player => ({ id: player.id, online: player.online }))).toEqual(seatsBeforeExit);
  await check(roomRow(directory, room)).toContainText('0 人观战');
  await watcher.reload();
  await check(watcher.locator('#create')).toBeVisible();
  check(await session(watcher)).toBeNull();
  await leave(host);
  await check(roomRow(directory, room)).toHaveCount(0);
  if (!realPeer) await check(directory.locator('.room-directory-empty')).toBeVisible();
  check(errors).toEqual([]);
  console.log(JSON.stringify({ mode, directory: 'inline homepage list on desktop and mobile; direct watch entry; updates retain focus; next-round voting withdraws room and dealing restores it; return home restores list; closed room withdrawn',
    privacy: 'no hands or secret predictions with foresight in rounds 1 and 2; settled bids/scores remain public while next-round voting waits',
    authority: 'three forged spectator actions rejected', refresh: 'spectator public snapshot restored during round-2 voting; host reload reconnected without spectator reload',
    activity: 'all three card plays, trick winner, round scores and public chat synchronized',
    mobile: '390px without horizontal overflow or activity/action overlap', exit: 'no player seat or online status changed', errors }));
} catch (error) {
  console.error(JSON.stringify({ mode, errors, pages: await Promise.all(pages.filter(page => !page.isClosed()).map(async page => ({
    url: page.url(), body: await page.locator('body').innerText().catch(() => 'unavailable'),
    session: await session(page).then(saved => saved ? { role: saved.role, room: saved.room, me: saved.me,
      phase: (saved.state || saved.game)?.phase, round: (saved.state || saved.game)?.round } : null).catch(() => 'unavailable'),
  }))) }));
  throw error;
} finally { await browser.close(); }
