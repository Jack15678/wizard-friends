import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomTransport } from '../src/room-transport.js';
import { FakeSocket } from './fake-socket.js';

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  FakeSocket.instances = [];
  const statuses = [], messages = [], inbound = [], errors = [];
  let opens = 0;
  const transport = createRoomTransport({ host: false, room: 'ABCDEFGH', token: 'test-token',
    url: 'ws://localhost/api/rooms/ABCDEFGH/ws', WebSocket: FakeSocket,
    retryMs: 10, maxRetryMs: 40, timeoutMs: 100, heartbeatMs: 1000,
    onStatus: value => statuses.push(value), onData: value => messages.push(value),
    onOpen: () => opens++, onConnection: (conn, current) => inbound.push({ conn, current }),
    onFatal: value => errors.push(value), ...options });
  t.after(() => transport.stop());
  return { transport, statuses, messages, inbound, errors, opens: () => opens };
}
const socket = () => FakeSocket.instances.at(-1);
function connect() { socket().open(); socket().receive({ type: 'ready' }); return socket(); }

test('guest authenticates without URL credentials, and waits for its permitted snapshot', t => {
  const s = setup(t); const ws = connect();
  assert.equal(ws.url.includes('test-token'), false);
  assert.deepEqual(ws.sent[0], { type: 'hello', host: false, token: 'test-token' });
  assert.deepEqual(s.statuses, ['connecting']); assert.equal(s.opens(), 1);
  ws.receive({ type: 'data', data: { type: 'state', state: { phase: 'rules' } } });
  s.transport.ready(); assert.equal(s.statuses.at(-1), 'connected'); assert.equal(s.messages.length, 1);
});
test('lost connections back off and discard old listeners; actions are never replayed', t => {
  const s = setup(t); const old = connect(); s.transport.ready();
  assert.equal(s.transport.send({ type: 'action' }), true); old.close();
  assert.equal(s.transport.send({ type: 'action' }), false);
  t.mock.timers.tick(10); const next = connect();
  old.receive({ type: 'data', data: 'stale' });
  assert.deepEqual(s.messages, []); assert.equal(s.opens(), 2);
  assert.deepEqual(next.sent, [{ type: 'hello', host: false, token: 'test-token' }]);
  for (const delay of [10, 20, 40, 40]) {
    socket().close(); const count = FakeSocket.instances.length;
    t.mock.timers.tick(delay - 1); assert.equal(FakeSocket.instances.length, count);
    t.mock.timers.tick(1); assert.equal(FakeSocket.instances.length, count + 1);
  }
});
test('host routes snapshots to a single connection and marks disconnected seats offline', t => {
  const s = setup(t, { host: true }); const ws = connect();
  assert.equal(s.statuses.at(-1), 'connected');
  ws.receive({ type: 'joined', id: 'one' }); ws.receive({ type: 'joined', id: 'two' });
  const first = s.inbound[0]; let closedWhileCurrent = false;
  first.conn.on('close', () => { closedWhileCurrent = first.current(); });
  first.conn.send({ private: 'only one' });
  assert.deepEqual(ws.sent.at(-1), { type: 'send', id: 'one', data: { private: 'only one' } });
  ws.receive({ type: 'left', id: 'one' }); assert.equal(closedWhileCurrent, true);
  assert.equal(first.current(), false); assert.equal(first.conn.open, false);
});
test('host wake closes old routes, announces reconnect and publishes current directory metadata', t => {
  const s = setup(t, { host: true }); const old = connect();
  old.receive({ type: 'joined', id: 'one' });
  s.transport.advertise({ room: 'ABCDEFGH' });
  assert.equal(old.sent.at(-1).type, 'advertise');
  s.transport.wake(); assert.equal(s.inbound[0].conn.open, false);
  assert.equal(s.statuses.at(-1), 'retrying'); connect();
  s.transport.closeRoom(); assert.equal(socket().sent.at(-1).type, 'close-room');
});
test('fatal ownership error stops automatic retries', t => {
  const s = setup(t); socket().open(); socket().receive({ type: 'fatal', message: 'wrong owner' });
  t.mock.timers.tick(10000); assert.equal(FakeSocket.instances.length, 1);
  assert.deepEqual(s.errors, ['wrong owner']); assert.equal(s.transport.send({}), false);
});
test('heartbeat detects half-open sockets and stop cancels all recovery', t => {
  const s = setup(t); connect(); s.transport.ready();
  t.mock.timers.tick(3000); assert.equal(s.statuses.at(-1), 'retrying');
  s.transport.stop(); t.mock.timers.tick(10000); assert.equal(FakeSocket.instances.length, 1);
});
