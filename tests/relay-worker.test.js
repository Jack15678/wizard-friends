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
  const hello = (ws, host, secret = token) => message(ws, { type: 'hello', version: 2, host, token: secret });
  return { ctx, env, relay, add, message, hello, advertisements };
}
test('authority ownership and private state survive hibernation; all valid host connections count', async () => {
  const s = setup(), host = s.add('host'); await s.hello(host, true);
  assert.equal(host.sent[0].type, 'ready'); assert.notEqual(s.ctx.store.get('owner'), token);
  const initialId = host.sent.at(-1).data.me;
  const recreated = new RoomRelay(s.ctx, s.env), impostor = s.add('impostor');
  await recreated.webSocketMessage(impostor, JSON.stringify({ type: 'hello', version: 2, host: true, token: otherToken }));
  assert.equal(impostor.sent.at(-1).type, 'fatal');
  const resumed = s.add('resumed');
  await recreated.webSocketMessage(resumed, JSON.stringify({ type: 'hello', version: 2, host: true, token }));
  assert.equal(resumed.sent.at(-1).data.me, initialId);
  assert.equal(host.data.removed, undefined);
  await recreated.webSocketClose(host);
  assert.equal(recreated.authority.hostOnline(), true);
  await recreated.webSocketClose(resumed);
  assert.equal(recreated.authority.hostOnline(), false);
});
test('clients cannot route private snapshots, forge host identity, or publish directory state', async () => {
  const s = setup(), host = s.add('host'), a = s.add('a'), b = s.add('b');
  await s.hello(host, true); await s.hello(a, false, otherToken);
  await s.hello(b, false, '33333333-3333-4333-a333-333333333333');
  const hostId = host.sent.at(-1).data.me;
  await s.message(a, { type: 'send', id: 'host', data: { type: 'action', actor: hostId, action: { type: 'beginVote' } } });
  assert.equal(s.relay.authority.game.phase, 'lobby');
  assert.ok(a.sent.some(m => m.data?.type === 'error'));
  await s.message(host, { type: 'send', id: 'a', data: { hand: ['private snapshot'] } });
  assert.equal(a.sent.some(m => m.data?.hand), false);
  await s.message(a, { type: 'advertise', room: descriptor });
  assert.equal(s.advertisements.every(entry => entry.descriptor === null), true);
  assert.ok(s.ctx.store.has('authority'));
});
test('host departure retains guests and their reconnect remains independent of host availability', async () => {
  const s = setup(), host = s.add('host'), guest = s.add('guest');
  await s.hello(host, true); await s.hello(guest, false, otherToken);
  const guestId = guest.sent.at(-1).data.me;
  await s.relay.webSocketClose(host);
  assert.equal(guest.code, undefined);
  assert.equal(guest.sent.at(-1).data.state.lifecycle.hostOffline, true);
  const next = s.add('new'); await s.hello(next, false, otherToken);
  assert.equal(next.sent.at(-1).data.me, guestId);
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

test('an authenticated legacy owner migrates exact hands and seat identities once without dealing again', async () => {
  const s = setup(), original = s.add('legacy-owner'); await s.hello(original, true);
  const ownerId = original.sent.at(-1).data.me;
  const source = structuredClone(s.relay.authority.game);
  source.players = [
    { ...source.players[0], id: ownerId, hand: [{ id: 'blue-9', kind: 'number', suit: 'blue', rank: 9 }], bid: 1, score: 40, won: 0 },
    { id: 'legacy-guest', name: '旧访客', bot: false, online: true, hand: [{ id: 'red-2', kind: 'number', suit: 'red', rank: 2 }], bid: 0, score: 20, won: 0 },
    { id: 'legacy-bot', name: '旧机器人', bot: true, online: true, hand: [{ id: 'wizard-0', kind: 'wizard' }], bid: 1, score: -10, won: 0 },
  ];
  Object.assign(source, { phase: 'play', round: 4, cardsPerRound: 4, turn: 1, turnDeadline: Date.now() + 22000,
    options: { ...source.options, predictionMode: 'secret' }, history: [{ round: 3, result: [] }] });
  s.ctx.store.delete('authority'); original.serializeAttachment({ ...original.data, removed: true });
  const worker = new RoomRelay(s.ctx, s.env), host = s.add('migrating');
  await worker.webSocketMessage(host, JSON.stringify({ type: 'hello', version: 2, host: true, token, snapshot: source, identities: { [token]: ownerId, [otherToken]: 'legacy-guest' } }));
  assert.equal(worker.authority.game.round, 4); assert.equal(worker.authority.game.phase, 'play');
  assert.notDeepEqual(worker.authority.game.randomState, source.randomState, 'legacy future random stream is replaced by fresh server entropy');
  assert.deepEqual(worker.authority.game.players.map(p => p.hand), source.players.map(p => p.hand));
  assert.ok(worker.authority.record.frozen.remaining > 21000);
  assert.equal(worker.authority.game.turnDeadline, null, 'legacy current seat receives reconnect grace before its clock resumes');
  assert.equal(host.sent.at(-1).data.state.players[1].bid, null);
  const guest = s.add('returning-guest');
  await worker.webSocketMessage(guest, JSON.stringify({ type: 'hello', version: 2, host: false, token: otherToken }));
  assert.equal(guest.sent.at(-1).data.me, 'legacy-guest');
  assert.deepEqual(guest.sent.at(-1).data.state.players[1].hand, source.players[1].hand);
  const maliciousReplacement = { ...source, round: 1 };
  const nextHost = s.add('repeated-upload');
  await worker.webSocketMessage(nextHost, JSON.stringify({ type: 'hello', version: 2, host: true, token, snapshot: maliciousReplacement }));
  assert.equal(worker.authority.game.round, 4, 'existing authority cannot be overwritten by a browser snapshot');
});

test('late room-service recovery gives time before an incoming message can trigger a false timeout', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const s = setup(), host = s.add('host'), guest = s.add('guest');
  await s.hello(host, true); await s.hello(guest, false, otherToken);
  const game = s.relay.authority.game;
  Object.assign(game, { phase: 'play', round: 1, cardsPerRound: 1, maxRounds: 5, turn: 1, turnDeadline: Date.now() + 1000 });
  game.players[0].hand = [{ id: 'red-1', kind: 'number', suit: 'red', rank: 1 }];
  game.players[1].hand = [{ id: 'blue-1', kind: 'number', suit: 'blue', rank: 1 }];
  game.players.forEach(p => { p.bid = 0; });
  s.relay.authority.record.alarmAt = Date.now() + 1000;
  t.mock.timers.tick(17000);
  await s.message(guest, { type: 'send', data: { type: 'action', action: { type: 'chat', text: '服务刚刚恢复' } } });
  assert.equal(game.trick.length, 0);
  assert.ok(game.turnDeadline >= Date.now() + 8000);
  await s.message(guest, { type: 'send', data: { type: 'action', action: { type: 'play', card: 'blue-1' } } });
  assert.equal(game.trick.length, 1);
});

test('new room cannot import a fabricated private deck and old protocol receives a terminal upgrade notice', async () => {
  const s = setup(), attacker = s.add('attacker');
  await s.message(attacker, { type: 'hello', version: 2, host: true, token, snapshot: { players: [], history: [] } });
  assert.equal(attacker.sent.at(-1).type, 'fatal');
  assert.equal(s.ctx.store.has('owner'), false);
  const old = s.add('old-version');
  await s.message(old, { type: 'hello', host: true, token });
  assert.equal(old.sent.at(-1).type, 'fatal');
  assert.match(old.sent.at(-1).message, /刷新/);
  assert.equal(s.ctx.store.has('authority'), false);
});

test('action errors echo only bounded request IDs to their initiating client', async () => {
  const s = setup(), host = s.add('host'), guest = s.add('guest');
  await s.hello(host, true); await s.hello(guest, false, otherToken);
  await s.message(guest, { type: 'send', data: { type: 'action', requestId: 'play:123-abc', action: { type: 'play', card: 'blue-1' } } });
  assert.equal(guest.sent.findLast(m => m.data?.type === 'error').data.requestId, 'play:123-abc');
  assert.equal(host.sent.some(m => m.data?.requestId === 'play:123-abc'), false);
  await s.message(guest, { type: 'send', data: { type: 'action', requestId: 'x'.repeat(81), action: { type: 'play', card: 'blue-1' } } });
  assert.equal(Object.hasOwn(guest.sent.findLast(m => m.data?.type === 'error').data, 'requestId'), false);
});
