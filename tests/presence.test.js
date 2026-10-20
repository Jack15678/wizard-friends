import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPresence, presenceRoom } from '../src/presence.js';

function transport() {
  const peers = new Map();
  let seq = 0;
  class Connection extends EventEmitter {
    open = true;
    send(message) { queueMicrotask(() => { if (this.open) this.other.emit('data', message); }); }
    close() {
      if (!this.open) return;
      this.open = this.other.open = false;
      this.emit('close'); this.other.emit('close');
    }
  }
  return class Peer extends EventEmitter {
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
      this.connections.push(conn);
      queueMicrotask(() => {
        const target = peers.get(id);
        if (!target) return conn.emit('error', { type: 'peer-unavailable' });
        target.connections.push(other);
        target.emit('connection', other);
        conn.emit('open'); other.emit('open');
      });
      return conn;
    }
    destroy() {
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
});

test('presence scope ignores invitations, separates forks and local preview', () => {
  const room = origin => presenceRoom({ origin, pathname: '/wizard-friends/' });
  assert.equal(room('https://xsk23.github.io'), room('https://xsk23.github.io'));
  assert.notEqual(room('https://xsk23.github.io'), room('http://localhost:5173'));
  assert.equal(room('https://xsk23.github.io'),
    presenceRoom({ origin: 'https://xsk23.github.io', pathname: '/wizard-friends/index.html' }));
});
