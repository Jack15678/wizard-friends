import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresence } from '../src/presence.js';
import { publicRoom, publicRooms } from '../src/public-room.js';
import { FakeSocket } from './fake-socket.js';
const room = { room: 'ABCDEFGH', hostName: '房主', players: 3, round: 1, maxRounds: 5, phase: 'bid', spectators: 0 };
test('directory whitelist cannot carry hands, chat or identity tokens', () => {
  assert.deepEqual(publicRoom({ ...room, hand: ['secret'], token: 'secret', chat: ['secret'] }), room);
  for (const change of [{ phase: 'rules' }, { players: 7 }, { round: 0 }, { spectators: 51 }]) assert.equal(publicRoom({ ...room, ...change }), null);
  assert.deepEqual(publicRooms([room, room, { room: 'bad' }]), [room]);
});
test('presence reconnect reports unavailable instead of fabricated zero; stop closes socket', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); FakeSocket.instances = [];
  const values = [];
  const p = createPresence({ visitor: 'visitor', url: 'ws://localhost/api/presence', WebSocket: FakeSocket, retryMs: 10, onChange: value => values.push(value) });
  t.after(() => p.stop());
  const first = FakeSocket.instances.at(-1); first.open(); first.receive({ type: 'ready' });
  first.receive({ type: 'directory', count: 2, rooms: [room] });
  assert.deepEqual(values.at(-1), { count: 2, status: 'online', rooms: [room] });
  first.close(); assert.equal(values.at(-1).count, null); t.mock.timers.tick(10);
  assert.equal(FakeSocket.instances.length, 2); p.stop(); assert.equal(FakeSocket.instances.at(-1).readyState, 3);
});
