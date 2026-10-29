import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// LOCAL/MANUAL ONLY. This in-memory wrapper exposes a harness RPC to the Node
// test process. It delegates every browser request/socket to the production DO;
// no clock route or test method is added to the shipped Worker or web client.
const built = await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'local-continuation-harness.js', contents: `
  import worker, {RoomRelay as ProductionRoom, RoomDirectory} from './worker/index.js';
  import {DurableObject} from 'cloudflare:workers';
  export {RoomDirectory};
  export class RoomRelay extends DurableObject {
    constructor(ctx,env) { super(ctx,env); this.impl=new ProductionRoom(ctx,env); this.context=ctx; }
    fetch(request) { return this.impl.fetch(request); }
    webSocketMessage(ws,message) { return this.impl.webSocketMessage(ws,message); }
    webSocketClose(ws,code,reason,clean) { return this.impl.webSocketClose(ws,code,reason,clean); }
    webSocketError(ws,error) { return this.impl.webSocketError(ws,error); }
    alarm() { return this.impl.alarm(); }
    async expireRetentionForLocalTest() {
      return this.impl.serial(async()=>{
        if (this.impl.authority.hostOnline()) throw new Error('Host must actually disconnect first');
        const now=Date.now();
        this.impl.authority.life.retentionDeadline=now-1;
        if(this.impl.authority.life.paused) this.impl.authority.life.pauseOfflineDeadline=now-1;
        this.impl.advance(now);
        await this.impl.persistAndPublish(await this.context.storage.get('room'));
        return this.impl.authority.life.continuationVote;
      });
    }
  }
  export default worker;
` }, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], write: false });
const mf = new Miniflare(convertV4MiniflareOptions({ name: 'continuation-local', script: built.outputFiles[0].text, modules: true,
  compatibilityDate: '2026-10-20', port: Number(process.env.CONTINUATION_PORT || 8788),
  durableObjects: { ROOMS: { className: 'RoomRelay', useSQLite: true }, DIRECTORY: { className: 'RoomDirectory', useSQLite: true } },
  serviceBindings: { ASSETS: async request => {
    const url = new URL(request.url);
    let filename = path.resolve('dist', `.${url.pathname}`);
    if (!filename.startsWith(path.resolve('dist') + path.sep) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.resolve('dist/index.html');
    const type = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(filename)] || 'application/octet-stream';
    return new Response(fs.readFileSync(filename), {headers:{'Content-Type':type}});
  } },
}));
const base = (await mf.ready).href;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const clients = [], errors = [];
const view = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session') || 'null')?.state);
const connected = page => page.locator('body[data-connection="connected"]').waitFor({ timeout: 30000 });
const prepare = async (context, name) => {
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base, {waitUntil:'domcontentloaded'});
  await page.locator('#create').waitFor();
  if (await page.locator('#nickname').count()) await page.locator('#nickname').fill(name);
  return page;
};
async function resumeHost(context) {
  const page = await prepare(context, '房主');
  await page.locator('#resume-room').click(); await connected(page);
  return page;
}
async function act(page) {
  if (await page.locator('[data-trump]').count()) { await page.locator('[data-trump]').first().click(); return; }
  if (await page.locator('[data-bid]').count()) { await page.locator('[data-bid]').first().click(); return; }
  const state = await view(page);
  const me = await page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session')).me);
  if (state.phase === 'play' && state.players[state.turn].id === me && state.legal.length) {
    await page.locator(`.hand [data-card="${state.legal[0]}"]`).click();
    await page.locator('#confirm-play').click();
  }
}
try {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  let host = await prepare(hostContext, '房主'); clients.push(host);
  const guest = await prepare(await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }), '续赛甲'); clients.push(guest);
  const other = await prepare(await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }), '续赛乙'); clients.push(other);
  await host.locator('#create').click(); await connected(host);
  const room = await host.locator('.room-code').innerText();
  for (const page of [guest, other]) {
    await page.locator('#join-menu').click(); await page.locator('#room-input').fill(room);
    await page.locator('#join').click(); await connected(page);
  }
  await expect.poll(async () => (await view(host))?.players.length).toBe(3);
  await host.locator('#begin-vote').click();
  for (const page of [host, guest, other]) {
    await page.locator('#vote-form').waitFor();
    for (const [key, value] of Object.entries({ short: true, predictionMode: 'public', foresight: false })) await page.locator(`input[name="${key}"][value="${value}"]`).check();
    await page.locator('#submit-vote').click();
  }
  await host.locator('#start').click();
  for (let step = 0; step < 12 && (await view(host)).phase !== 'play'; step++) {
    for (const page of [host, guest, other]) await act(page);
    await host.waitForTimeout(60);
  }
  await expect.poll(async () => (await view(host)).phase).toBe('play');
  await host.locator('#room-pause').click();
  await expect.poll(async () => (await view(guest)).lifecycle.paused).toBe(true);
  await host.close();
  await expect.poll(async () => (await view(guest)).lifecycle.hostOffline, { timeout: 15000 }).toBe(true);
  const namespace = await mf.getDurableObjectNamespace('ROOMS');
  const roomStub = namespace.get(namespace.idFromName(room));
  const ballot = await roomStub.expireRetentionForLocalTest();
  expect(ballot.voters).toHaveLength(2);
  await guest.locator('#continue-yes').waitFor(); await other.locator('#continue-yes').waitFor();
  fs.mkdirSync('output/playwright', { recursive: true });
  await other.screenshot({ path: 'output/playwright/continuation-mobile-vote.png' });
  host = await resumeHost(hostContext); clients[0] = host;
  await expect.poll(async () => (await view(host)).lifecycle.continuationVote?.voters.length).toBe(2);
  await expect(host.locator('#continue-yes')).toHaveCount(0);
  // Even an authenticated owner request cannot cancel a vote after it began.
  const refused = await host.evaluate(roomCode => new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.origin.replace('http','ws')}/api/rooms/${roomCode}/ws`);
    const timer = setTimeout(() => reject(new Error('resume rejection timeout')), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', version: 2, host: true,
      token: sessionStorage.getItem('wizard-player-token'), name: '房主' }));
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'ready') ws.send(JSON.stringify({ type: 'send', data: { type: 'resume' } }));
      if (message.type === 'data' && message.data.type === 'error') { clearTimeout(timer); ws.close(); resolve(message.data.message); }
    };
  }), room);
  expect(refused).toMatch(/不会取消/);
  await host.close();
  await expect.poll(async () => (await view(guest)).lifecycle.hostOffline).toBe(true);
  await guest.locator('#continue-yes').click(); await other.locator('#continue-yes').click();
  await expect.poll(async () => (await view(guest)).lifecycle.closeAfterRound).toBe(true);
  for (let step = 0; step < 40 && (await view(guest)).phase !== 'roundEnd'; step++) {
    for (const page of [guest, other]) await act(page);
    await guest.waitForTimeout(100);
  }
  await expect.poll(async () => (await view(guest)).phase, { timeout: 20000 }).toBe('roundEnd');
  const result = (await view(guest)).history;
  expect(result).toHaveLength(1);
  expect((await view(other)).history).toEqual(result);
  host = await resumeHost(hostContext); clients[0] = host;
  await expect.poll(async () => (await view(host)).lifecycle.closeAfterRound).toBe(true);
  await expect(host.locator('#confirm-results')).toBeVisible();
  await host.screenshot({ path: 'output/playwright/continuation-mobile-result.png' });
  for (const page of [host, guest, other]) await page.locator('#confirm-results').click();
  for (const page of [host, guest, other]) await page.locator('#create').waitFor();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ clients: 3, runtime: 'isolated Miniflare + actual WebSockets',
    clockControl: 'script-only RPC shortens persisted retention; real 60-second vote and normal turn timers',
    verified: ['actual host tab close', 'fresh-tab host return', 'online humans only vote', 'owner return cannot cancel vote',
      'unanimous continuation', 'offline seat substitution', 'one round scores synchronized', 'owner cannot unset close marker',
      'all online humans confirm results then close'], errors }));
} catch (error) {
  console.error(error);
  console.error(JSON.stringify({errors}));
  for (const [i,page] of clients.entries()) if (!page.isClosed()) await page.screenshot({ path: `output/playwright/continuation-failure-${i}.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); await Promise.race([mf.dispose(),new Promise(resolve=>setTimeout(resolve,2000))]); }
