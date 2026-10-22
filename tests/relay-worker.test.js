import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { RoomRelay, RoomDirectory } from '../worker/index.js';

globalThis.WebSocketRequestResponsePair = class {};
class Socket {
  constructor(data = {}) { this.data = data; this.sent = []; }
  serializeAttachment(value) { this.data = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.data); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close(code) { this.code = code; }
}
function context() {
  const store = new Map(), sockets = [];
  return { store, sockets, getWebSockets: () => sockets, setWebSocketAutoResponse() {},
    blockConcurrencyWhile: callback => callback(),
    storage: {
      get: async key => store.get(key),
      put: async (key, value) => { for (const [k, v] of typeof key === 'object' ? Object.entries(key) : [[key, value]]) store.set(k, v); },
      delete: async key => store.delete(key), deleteAll: async () => store.clear(), setAlarm: async () => {},
      list: async ({ prefix }) => new Map([...store].filter(([key]) => key.startsWith(prefix))),
    },
  };
}
const token = '11111111-1111-4111-a111-111111111111';
const otherToken = '22222222-2222-4222-a222-222222222222';
const descriptor = { room: 'ABCDEFGH', hostName: '房主', players: 3, round: 1, maxRounds: 5, phase: 'bid', spectators: 0 };
function setup() {
  const ctx = context(), advertisements = [];
  const env = { DIRECTORY: { getByName: () => ({ fetch: async (url, init) => { advertisements.push(JSON.parse(init.body)); return Response.json({}); } }) } };
  const relay = new RoomRelay(ctx, env);
  const add = (id) => { const ws = new Socket({ id, room: 'ABCDEFGH' }); ctx.sockets.push(ws); return ws; };
  const message = (ws, value) => relay.webSocketMessage(ws, JSON.stringify(value));
  const hello = (ws, host, secret = token) => message(ws, { type: 'hello', host, token: secret });
  return { ctx, env, relay, add, message, hello, advertisements };
}
test('room ownership survives hibernation and rejects a different host token', async () => {
  const s = setup(), host = s.add('host'); await s.hello(host, true);
  assert.equal(host.sent.at(-1).type, 'ready'); assert.notEqual(s.ctx.store.get('owner'), token);
  const recreated = new RoomRelay(s.ctx, s.env), impostor = s.add('impostor');
  await recreated.webSocketMessage(impostor, JSON.stringify({ type: 'hello', host: true, token: otherToken }));
  assert.equal(impostor.sent.at(-1).type, 'fatal'); assert.equal(s.relay.host(), host);
  const resumed = s.add('resumed'); await s.hello(resumed, true);
  assert.equal(s.relay.host(), resumed); assert.equal(host.data.removed, true);
});
test('guest cannot select another sender, broadcast snapshots or publish a directory entry', async () => {
  const s = setup(), host = s.add('host'), a = s.add('a'), b = s.add('b');
  await s.hello(host, true); await s.hello(a, false); await s.hello(b, false);
  await s.message(a, { type: 'send', id: 'b', data: { type: 'action', actor: 'host' } });
  assert.deepEqual(host.sent.at(-1), { type: 'data', id: 'a', data: { type: 'action', actor: 'host' } });
  assert.equal(b.sent.length, 1);
  await s.message(host, { type: 'send', id: 'a', data: { hand: ['only a'] } });
  assert.deepEqual(a.sent.at(-1).data, { hand: ['only a'] }); assert.equal(b.sent.length, 1);
  await s.message(a, { type: 'advertise', room: descriptor }); assert.deepEqual(s.advertisements, []);
  assert.deepEqual([...s.ctx.store.keys()].sort(), ['owner', 'room']);
});
test('host departure interrupts guests; late close from replaced host cannot evict the new host', async () => {
  const s = setup(), host = s.add('host'), guest = s.add('guest');
  await s.hello(host, true); await s.hello(guest, false);
  await s.relay.webSocketClose(host); assert.equal(guest.code, 1012);
  const next = s.add('new'); await s.hello(next, true);
  await s.relay.webSocketClose(host); assert.equal(s.relay.host(), next);
});
test('explicit close persists across reconnect and invalid frames are rejected', async () => {
  const s = setup(), host = s.add('host'), guest = s.add('guest');
  await s.hello(host, true); await s.hello(guest, false);
  await s.message(host, { type: 'close-room' }); assert.equal(s.ctx.store.get('closed'), true);
  const returning = s.add('returning'); await s.hello(returning, false);
  assert.equal(returning.sent.at(-1).type, 'fatal');
  const invalid = s.add('invalid'); await s.relay.webSocketMessage(invalid, 'x'.repeat(262145)); assert.equal(invalid.code, 1009);
});
test('directory strips secrets, deduplicates browsers and expires missing host summaries', async () => {
  const ctx = context(), directory = new RoomDirectory(ctx);
  const a = new Socket(), b = new Socket(); ctx.sockets.push(a, b);
  const hello = JSON.stringify({ type: 'hello', visitor: token });
  await directory.webSocketMessage(a, hello); await directory.webSocketMessage(b, hello);
  await directory.fetch(new Request('https://directory/update', { method: 'POST', body: JSON.stringify({ room: descriptor.room, descriptor: { ...descriptor, token, hand: ['secret'] } }) }));
  assert.equal(a.sent.at(-1).count, 1); assert.deepEqual(a.sent.at(-1).rooms, [descriptor]);
  ctx.store.get('room:ABCDEFGH').expires = 0; await directory.alarm();
  assert.deepEqual(a.sent.at(-1).rooms, []); assert.equal(ctx.store.has('room:ABCDEFGH'), false);
  await directory.webSocketClose(a); assert.equal(b.sent.at(-1).count, 1);
});
test('public worker refuses unexpected origins and cannot expose directory write routes', async () => {
  const env = { ASSETS: { fetch: () => new Response('assets') } };
  const request = (path, origin) => new Request(`https://game.example${path}`, { headers: { Upgrade: 'websocket', Origin: origin } });
  assert.equal((await worker.fetch(request('/api/presence', 'https://evil.example'), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/update', 'https://game.example'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://game.example/api/presence'), env)).status, 426);
});
