import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRoomTransport } from '../src/room-transport.js';

class Connection extends EventEmitter {
  open = false;
  sent = [];
  start() { this.open = true; this.emit('open'); }
  send(message) {
    if (this.failSend) throw new Error('channel closed while sending');
    this.sent.push(message);
  }
  close() {
    this.open = false;
    this.emit('close');
  }
}

function setup(t, overrides = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class Peer extends EventEmitter {
    static instances = [];
    static failConstructor = false;
    connections = [];
    reconnects = 0;
    constructor(id, options) {
      super();
      if (Peer.failConstructor) throw new Error('constructor failed');
      this.id = typeof id === 'string' ? id : `guest-${Peer.instances.length}`;
      this.options = typeof id === 'string' ? options : id;
      Peer.instances.push(this);
    }
    connect(id, options) {
      if (this.failConnect) throw new Error('connect failed');
      const connection = new Connection();
      connection.peer = id;
      connection.options = options;
      this.connections.push(connection);
      return connection;
    }
    reconnect() {
      this.reconnects++;
      if (this.failReconnect) throw new Error('signaling not ready');
    }
    destroy() {
      this.destroyed = true;
      for (const connection of this.connections) connection.close();
      this.emit('close');
    }
  }
  const statuses = [], messages = [], inbound = [];
  let opens = 0;
  const transport = createRoomTransport({
    Peer, host: false, room: 'abc123', retryMs: 10, maxRetryMs: 40, timeoutMs: 100,
    onStatus: status => statuses.push(status), onData: message => messages.push(message),
    onOpen: () => { opens++; }, onConnection: (connection, current) => inbound.push({ connection, current }),
    ...overrides,
  });
  t.after(() => transport.stop());
  return { Peer, transport, statuses, messages, inbound, opens: () => opens };
}

function openGuest(Peer) {
  const peer = Peer.instances.at(-1);
  peer.emit('open', peer.id);
  const connection = peer.connections[0];
  connection.start();
  return { peer, connection };
}

test('host retries a temporarily occupied fixed ID with capped backoff', t => {
  const { Peer, statuses } = setup(t, { host: true });
  for (const wait of [10, 20, 40, 40, 40]) {
    const previous = Peer.instances.at(-1);
    assert.equal(previous.id, 'wizard-friends-abc123');
    previous.emit('error', { type: 'unavailable-id' });
    assert.equal(previous.destroyed, true);
    const count = Peer.instances.length;
    t.mock.timers.tick(wait - 1);
    assert.equal(Peer.instances.length, count);
    t.mock.timers.tick(1);
    assert.equal(Peer.instances.length, count + 1);
  }
  Peer.instances.at(-1).emit('open');
  assert.deepEqual(statuses, ['connecting', 'retrying', 'connected']);
  t.mock.timers.tick(1000);
  assert.equal(Peer.instances.length, 6);
});

test('guest waits across host downtime and only becomes connected after restored state', t => {
  const { Peer, transport, statuses, messages, opens } = setup(t);
  let { connection } = openGuest(Peer);
  assert.equal(connection.peer, 'wizard-friends-abc123');
  assert.equal(opens(), 1);
  assert.deepEqual(statuses, ['connecting']);
  transport.ready();
  assert.equal(statuses.at(-1), 'connected');
  connection.close();
  assert.equal(statuses.at(-1), 'retrying');
  // A long host reload must not exhaust a fixed retry count.
  for (const wait of [10, 20, 40, 40, 40, 40, 40, 40]) {
    t.mock.timers.tick(wait);
    const peer = Peer.instances.at(-1);
    peer.emit('open');
    peer.emit('error', { type: 'peer-unavailable' });
  }
  t.mock.timers.tick(40);
  ({ connection } = openGuest(Peer));
  connection.emit('data', { type: 'welcome' });
  connection.emit('data', { type: 'state', phase: 'trick' });
  assert.equal(statuses.at(-1), 'retrying');
  transport.ready();
  assert.equal(statuses.at(-1), 'connected');
  assert.deepEqual(messages, [{ type: 'welcome' }, { type: 'state', phase: 'trick' }]);
});

test('stop invalidates late peer and connection callbacks without restarting', t => {
  const { Peer, transport, statuses, messages, opens } = setup(t);
  const { peer, connection } = openGuest(Peer);
  transport.ready();
  transport.stop();
  transport.stop();
  peer.emit('open');
  peer.emit('disconnected');
  peer.emit('error', { type: 'peer-unavailable' });
  peer.emit('close');
  connection.emit('data', { type: 'state' });
  connection.emit('open');
  connection.emit('error', new Error('late error'));
  transport.wake();
  transport.ready();
  t.mock.timers.tick(10000);
  assert.equal(Peer.instances.length, 1);
  assert.equal(peer.destroyed, true);
  assert.deepEqual(messages, []);
  assert.equal(opens(), 1);
  assert.deepEqual(statuses, ['connecting', 'connected']);
  assert.equal(transport.send({ type: 'join' }), false);
});

test('an open data channel without a completed welcome times out and retries', t => {
  const { Peer, transport, statuses } = setup(t);
  const { connection } = openGuest(Peer);
  assert.equal(transport.send({ type: 'join' }), true);
  t.mock.timers.tick(99);
  assert.deepEqual(statuses, ['connecting']);
  t.mock.timers.tick(1);
  assert.equal(connection.open, false);
  assert.equal(statuses.at(-1), 'retrying');
  t.mock.timers.tick(10);
  assert.equal(Peer.instances.length, 2);
});

test('signaling disconnection preserves a working data channel and avoids duplicate connections', t => {
  const { Peer, transport, statuses, messages, opens } = setup(t);
  const { peer, connection } = openGuest(Peer);
  transport.ready();
  peer.failReconnect = true;
  peer.emit('disconnected');
  peer.emit('disconnected');
  assert.equal(peer.reconnects, 1);
  t.mock.timers.tick(10);
  assert.equal(peer.reconnects, 2);
  t.mock.timers.tick(20);
  assert.equal(peer.reconnects, 3);
  peer.emit('error', { type: 'network' });
  assert.equal(transport.send({ type: 'action' }), true);
  connection.emit('data', { type: 'state' });
  assert.deepEqual(messages, [{ type: 'state' }]);
  assert.equal(connection.open, true);
  assert.equal(peer.destroyed, undefined);
  peer.failReconnect = false;
  peer.emit('open');
  peer.emit('open');
  connection.emit('open');
  t.mock.timers.tick(10000);
  assert.equal(peer.connections.length, 1);
  assert.equal(Peer.instances.length, 1);
  assert.equal(opens(), 1);
  assert.deepEqual(statuses, ['connecting', 'connected']);
});

test('host retains inbound channels across signaling reconnect and invalidates them on physical restart', t => {
  const { Peer, inbound, statuses } = setup(t, { host: true });
  const peer = Peer.instances[0];
  peer.emit('open');
  const connection = new Connection();
  connection.start();
  peer.emit('connection', connection);
  assert.equal(inbound[0].current(), true);
  peer.emit('disconnected');
  assert.equal(inbound[0].current(), true);
  assert.equal(connection.open, true);
  assert.equal(statuses.at(-1), 'connected');
  peer.emit('open');
  peer.emit('close');
  assert.equal(inbound[0].current(), false);
  assert.equal(statuses.at(-1), 'retrying');
  const late = new Connection();
  late.start();
  peer.emit('connection', late);
  assert.equal(late.open, false);
  assert.equal(inbound.length, 1);
});

test('old callbacks cannot replace or disconnect the new guest connection', t => {
  const { Peer, transport, messages } = setup(t);
  const old = openGuest(Peer);
  old.connection.close();
  t.mock.timers.tick(10);
  const next = openGuest(Peer);
  transport.ready();
  old.peer.emit('open');
  old.peer.emit('error', { type: 'peer-unavailable' });
  old.connection.emit('close');
  old.connection.emit('data', { type: 'stale' });
  next.connection.emit('data', { type: 'current' });
  t.mock.timers.tick(1000);
  assert.deepEqual(messages, [{ type: 'current' }]);
  assert.equal(Peer.instances.length, 2);
  assert.equal(transport.send({ type: 'action' }), true);
  assert.deepEqual(next.connection.sent, [{ type: 'action' }]);
});

test('send exceptions return false and start a recovery cycle', t => {
  const { Peer, transport, statuses } = setup(t);
  const { connection } = openGuest(Peer);
  transport.ready();
  connection.failSend = true;
  assert.equal(transport.send({ type: 'action' }), false);
  assert.equal(statuses.at(-1), 'retrying');
  t.mock.timers.tick(10);
  assert.equal(Peer.instances.length, 2);
});

test('wake immediately retries an unconnected transport but leaves connected peers alone', t => {
  const { Peer, transport } = setup(t);
  Peer.instances[0].emit('error', { type: 'peer-unavailable' });
  transport.wake();
  t.mock.timers.tick(0);
  assert.equal(Peer.instances.length, 2);
  openGuest(Peer);
  transport.ready();
  transport.wake();
  t.mock.timers.tick(1000);
  assert.equal(Peer.instances.length, 2);
});

test('synchronous connect and constructor exceptions are retried safely', t => {
  const { Peer, transport, statuses } = setup(t);
  const peer = Peer.instances[0];
  peer.failConnect = true;
  assert.doesNotThrow(() => peer.emit('open'));
  assert.equal(statuses.at(-1), 'retrying');
  Peer.failConstructor = true;
  assert.doesNotThrow(() => t.mock.timers.tick(10));
  assert.equal(Peer.instances.length, 1);
  Peer.failConstructor = false;
  t.mock.timers.tick(20);
  openGuest(Peer);
  transport.ready();
  assert.equal(statuses.at(-1), 'connected');
  t.mock.timers.tick(1000);
  assert.equal(Peer.instances.length, 2);
});
