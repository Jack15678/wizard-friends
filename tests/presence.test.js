import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPresence, presenceRoom } from '../src/presence.js';

function transport() {
  const peers = new Map();
  const sent = [];
  let seq = 0;
  class Connection extends EventEmitter {
    open = true;
    send(message) {
      sent.push({ from: this, message: structuredClone(message) });
      if (!this.dropSends) queueMicrotask(() => { if (this.open) this.other.emit('data', structuredClone(message)); });
    }
    close() {
      if (!this.open) return;
      this.open = this.other.open = false;
      this.emit('close'); this.other.emit('close');
    }
  }
  return class Peer extends EventEmitter {
    static peers = peers;
    static sent = sent;
    connections = [];
    constructor(id) {
      super();
      this.id = typeof id === 'string' ? id : `random-${++seq}`;
      queueMicrotask(() => {
        if (this.destroyed) return;
        if (peers.has(this.id)) this.emit('error', { type: 'unavailable-id' });
        else { peers.set(this.id, this); this.emit('open', this.id); }
      });
    }
    connect(id) {
      const conn = new Connection(), other = new Connection();
      conn.other = other; other.other = conn;
      conn.peer = id; other.peer = this.id;
      this.connections.push(conn);
      queueMicrotask(() => {
        if (this.destroyed || !conn.open) return;
        const target = peers.get(id);
        if (!target) return conn.emit('error', { type: 'peer-unavailable' });
        target.connections.push(other);
        target.emit('connection', other);
        conn.emit('open'); other.emit('open');
      });
      return conn;
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (peers.get(this.id) === this) peers.delete(this.id);
      for (const conn of this.connections) conn.close();
      this.emit('close');
    }
  };
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(check(), 'presence did not converge');
}

test('counts browsers, deduplicates tabs, removes departures and elects a replacement', async t => {
  const Peer = transport();
  const latest = [], clients = [];
  t.after(() => clients.forEach(client => client.stop()));
  const add = visitor => {
    const index = clients.length;
    clients.push(createPresence({ Peer, room: 'test', visitor,
      tickMs: 10, ttlMs: 100, retryMs: 5, timeoutMs: 100,
      onChange: value => { latest[index] = value; },
    }));
  };
  add('browser-aaaaaaaa'); add('browser-bbbbbbbb'); add('browser-bbbbbbbb');
  await until(() => latest.length === 3 && latest.every(x => x.count === 2));
  clients[2].stop();
  await until(() => latest[0].count === 2 && latest[1].count === 2);
  clients[0].stop();
  await until(() => latest[1].count === 1);
  add('browser-cccccccc');
  await until(() => latest[1].count === 2 && latest[3].count === 2);
});

test('signaling failure reports unavailable, never a fabricated count', async t => {
  class BrokenPeer extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('error', { type: 'network' })); }
    destroy() {}
  }
  let latest;
  const client = createPresence({ Peer: BrokenPeer, room: 'test', visitor: 'browser-aaaaaaaa',
    retryMs: 1000, onChange: value => { latest = value; } });
  t.after(() => client.stop());
  await until(() => latest.status === 'unavailable');
  assert.equal(latest.count, null);
  assert.deepEqual(latest.rooms, []);
});

const descriptor = (room = 'ABCD2345', overrides = {}) => ({
  room, hostName: '巫师房主', players: 3, round: 1, maxRounds: 20, phase: 'bid', spectators: 0, ...overrides,
});
function directory(t, overrides = {}) {
  const Peer = transport(), latest = [], clients = [];
  t.after(() => clients.forEach(client => client.stop()));
  const add = (visitor, settings = {}) => {
    const index = clients.length;
    const client = createPresence({ Peer, room: 'directory', visitor,
      tickMs: 10, ttlMs: 1000, retryMs: 5, timeoutMs: 100,
      onChange: value => { latest[index] = value; }, ...overrides, ...settings,
    });
    clients.push(client);
    return client;
  };
  return { Peer, latest, clients, add };
}

test('coordinator and members advertise, update and withdraw only public room summaries', async t => {
  const { add, latest, Peer } = directory(t);
  const first = add('browser-aaaaaaaa'), second = add('browser-bbbbbbbb');
  first.advertise(descriptor('ABCD2345', { hand: ['secret-card'], token: 'secret-token', chat: ['secret-chat'] }));
  const room = descriptor('BCDE2345');
  second.advertise(room);
  room.hostName = 'mutated-after-advertise';
  await until(() => latest.length === 2 && latest.every(value => value.rooms.length === 2));
  assert.deepEqual(latest[0].rooms, [descriptor(), descriptor('BCDE2345')]);
  assert.ok(Peer.sent.every(({ message }) => !JSON.stringify(message).includes('secret-')));
  second.advertise(descriptor('BCDE2345', { phase: 'play', spectators: 4, round: 2 }));
  await until(() => latest.every(value => value.rooms.find(room => room.room === 'BCDE2345')?.spectators === 4));
  first.advertise(null);
  await until(() => latest.every(value => value.rooms.length === 1));
  second.advertise(null);
  await until(() => latest.every(value => value.rooms.length === 0));
  assert.equal(latest[0].count, 2);
});

test('invalid descriptors withdraw an existing room and extra fields never survive sanitizing', async t => {
  const { add, latest } = directory(t);
  const client = add('browser-aaaaaaaa');
  await until(() => latest[0]?.status === 'online');
  const invalid = [
    { room: 'bad' }, { hostName: '' }, { hostName: 'x'.repeat(17) }, { hostName: 'bad\nname' },
    { players: 2 }, { players: 7 }, { players: 3.5 }, { round: 0 }, { round: 21 },
    { round: 3, maxRounds: 2 }, { maxRounds: 21 }, { maxRounds: 2.5 }, { phase: 'lobby' },
    { phase: 'finished' }, { spectators: -1 }, { spectators: 51 }, { spectators: '2' },
  ];
  for (const patch of invalid) {
    client.advertise(descriptor());
    assert.equal(latest[0].rooms.length, 1);
    client.advertise(descriptor('ABCD2345', patch));
    assert.deepEqual(latest[0].rooms, []);
  }
  client.advertise(descriptor('ABCD2345', { hostName: '  房主  ', identities: { secret: 'player' } }));
  assert.deepEqual(latest[0].rooms, [descriptor('ABCD2345', { hostName: '房主' })]);
});

test('unchanged normalized advertisements do not send another update or feed back from onChange', async t => {
  const { add, latest, Peer } = directory(t, { tickMs: 10000 });
  add('browser-aaaaaaaa');
  const client = add('browser-bbbbbbbb');
  client.advertise(descriptor());
  await until(() => latest[1]?.rooms.length === 1);
  const before = Peer.sent.length;
  client.advertise({ spectators: 0, phase: 'bid', maxRounds: 20, round: 1, players: 3,
    hostName: '巫师房主', room: 'ABCD2345', ignored: 'not-public' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(Peer.sent.length, before);
});

test('directory remains tab based while online counts deduplicate the same browser', async t => {
  const { add, latest } = directory(t);
  const first = add('browser-aaaaaaaa'), second = add('browser-aaaaaaaa');
  first.advertise(descriptor()); second.advertise(descriptor('BCDE2345'));
  await until(() => latest.length === 2 && latest.every(value => value.count === 1 && value.rooms.length === 2));
  second.stop();
  await until(() => latest[0].rooms.length === 1);
  assert.equal(latest[0].count, 1);
  assert.equal(latest[0].rooms[0].room, 'ABCD2345');
});

test('members re-advertise after coordinator replacement and the departed room disappears', async t => {
  const { add, latest } = directory(t);
  const first = add('browser-aaaaaaaa'), second = add('browser-bbbbbbbb'), third = add('browser-cccccccc');
  first.advertise(descriptor()); second.advertise(descriptor('BCDE2345')); third.advertise(descriptor('CDEF2345'));
  await until(() => latest.length === 3 && latest.every(value => value.rooms.length === 3));
  first.stop();
  await until(() => latest.slice(1).every(value => value.status === 'online' && value.count === 2 && value.rooms.length === 2));
  assert.deepEqual(latest[1].rooms.map(room => room.room), ['BCDE2345', 'CDEF2345']);
});

test('silent clients expire and withdraw room advertisements at the coordinator TTL', async t => {
  const { add, latest, Peer } = directory(t, { ttlMs: 60 });
  add('browser-aaaaaaaa');
  const member = add('browser-bbbbbbbb', { tickMs: 10000 });
  member.advertise(descriptor());
  await until(() => latest[0]?.rooms.length === 1);
  const coordinator = Peer.peers.get('directory');
  const inbound = coordinator.connections.find(connection => connection.other.peer === 'directory');
  assert.ok(inbound);
  inbound.other.dropSends = true;
  // Model a suspended tab that cannot process the close or start reconnecting.
  inbound.other.removeAllListeners('close');
  inbound.other.removeAllListeners('error');
  await until(() => latest[0].rooms.length === 0 && latest[0].count === 1);
});

test('room deduplication prefers the freshest valid report and falls back when it closes', async t => {
  const { add, latest } = directory(t, { tickMs: 10000 });
  const first = add('browser-aaaaaaaa'), second = add('browser-bbbbbbbb');
  first.advertise(descriptor());
  await until(() => latest[0]?.status === 'online' && latest[1]?.status === 'online');
  second.advertise(descriptor('ABCD2345', { round: 2 }));
  await until(() => latest.every(value => value.rooms.length === 1 && value.rooms[0].round === 2));
  second.stop();
  await until(() => latest[0].rooms.length === 1 && latest[0].rooms[0].round === 1);
});

test('directory admits at most 50 unique, current room descriptors', async t => {
  const { add, latest } = directory(t, { tickMs: 10000, timeoutMs: 1000 });
  for (let index = 0; index < 52; index++) {
    const client = add(`browser-${String(index).padStart(8, 'a')}`);
    const code = `AAAAAA${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`;
    client.advertise(descriptor(code));
  }
  await until(() => latest.length === 52 && latest.every(value => value.count === 52 && value.rooms.length === 50));
  assert.equal(new Set(latest[0].rooms.map(room => room.room)).size, 50);
});

test('legacy members without a room field still count and receive the room directory', async t => {
  const { add, latest, Peer } = directory(t);
  const host = add('browser-aaaaaaaa');
  host.advertise(descriptor());
  const legacy = new Peer();
  t.after(() => legacy.destroy());
  let received;
  legacy.on('open', () => {
    const connection = legacy.connect('directory');
    connection.on('open', () => connection.send({ type: 'present', visitor: 'browser-legacy-aa' }));
    connection.on('data', message => { received = message; });
  });
  await until(() => latest[0]?.count === 2 && received?.count === 2);
  assert.deepEqual(received.rooms, [descriptor()]);
});

test('member clients also sanitize coordinator directories before exposing public summaries', async t => {
  const Peer = transport();
  const coordinator = new Peer('directory');
  coordinator.on('connection', connection => {
    connection.on('data', () => connection.send({ type: 'count', count: 2, rooms: [
      descriptor('ABCD2345', { hand: ['secret-card'], token: 'secret-token' }),
      descriptor('BCDE2345', { phase: 'lobby' }), descriptor('ABCD2345', { round: 4 }),
    ] }));
  });
  let latest;
  const client = createPresence({ Peer, room: 'directory', visitor: 'browser-aaaaaaaa',
    onChange: value => { latest = value; }, retryMs: 1000 });
  t.after(() => { client.stop(); coordinator.destroy(); });
  await until(() => latest?.status === 'online');
  assert.deepEqual(latest.rooms, [descriptor()]);
});

test('a failed connection clears the directory instead of exposing stale rooms as live', async t => {
  const { add, latest, Peer } = directory(t, { retryMs: 1000 });
  const host = add('browser-aaaaaaaa');
  host.advertise(descriptor());
  await until(() => latest[0]?.rooms.length === 1);
  Peer.peers.get('directory').emit('error', { type: 'network' });
  assert.deepEqual(latest[0], { count: null, status: 'unavailable', rooms: [] });
});

test('presence scope ignores invitations, separates forks and local preview', () => {
  const room = origin => presenceRoom({ origin, pathname: '/wizard-friends/' });
  assert.match(room('https://xsk23.github.io'), /^wizard-presence-v2-/);
  assert.equal(room('https://xsk23.github.io'), room('https://xsk23.github.io'));
  assert.notEqual(room('https://xsk23.github.io'), room('http://localhost:5173'));
  assert.equal(room('https://xsk23.github.io'),
    presenceRoom({ origin: 'https://xsk23.github.io', pathname: '/wizard-friends/index.html' }));
});
