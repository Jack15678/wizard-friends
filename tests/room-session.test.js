import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, viewFor } from '../src/game.js';
import { ROOM_SESSION_KEY, readRoomSession, saveRoomSession, clearRoomSession } from '../src/room-session.js';

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}
function hostSession() {
  const game = createGame();
  addPlayer(game, 'host', '房主'); addPlayer(game, 'guest', '旅人');
  game.players[0].hand = [{ id: 'wizard-1', kind: 'wizard' }];
  game.players[1].hand = [{ id: 'red-7', suit: 'red', rank: 7, kind: 'number' }];
  return { role: 'host', room: 'ABCD2345', me: 'host', game, identities: { secretHostToken: 'host', secretGuestToken: 'guest' } };
}

test('host snapshot preserves hands, seat identities and chat across a reload', () => {
  const tab = storage(), saved = hostSession();
  saved.game.chat = [{ player: 'guest', text: '继续吧', seq: 1 }];
  saved.game.chatSeq = 1;
  assert.equal(saveRoomSession(tab, saved), true);
  assert.deepEqual(readRoomSession(tab), { ...saved, version: 1 });
});

test('guest snapshot contains only its view and never persists host identities or other hands', () => {
  const tab = storage(), host = hostSession();
  assert.equal(saveRoomSession(tab, { ...host, role: 'guest', me: 'guest', state: viewFor(host.game, 'guest') }), true);
  const saved = readRoomSession(tab);
  assert.equal(saved.game, undefined); assert.equal(saved.identities, undefined);
  assert.equal(saved.state.players[0].hand, undefined);
  assert.deepEqual(saved.state.players[1].hand, host.game.players[1].hand);
  assert.ok(!tab.getItem(ROOM_SESSION_KEY).includes('secretHostToken'));
  // Even if a caller accidentally supplies the complete state, other hands are removed.
  saveRoomSession(tab, { role: 'guest', room: host.room, me: 'guest', state: host.game });
  assert.equal(readRoomSession(tab).state.players[0].hand, undefined);
});

test('an explicit different invitation takes priority without deleting the original saved room', () => {
  const tab = storage(); saveRoomSession(tab, hostSession());
  assert.equal(readRoomSession(tab, 'WXYZ6789'), null);
  assert.equal(readRoomSession(tab, 'ABCD2345').role, 'host');
});

test('old host and guest sessions upgrade so an existing player can refresh into the new release', () => {
  const hostTab = storage(), saved = hostSession();
  const { role, ...legacy } = saved;
  hostTab.setItem('wizard-host', JSON.stringify(legacy));
  const recovered = readRoomSession(hostTab);
  assert.deepEqual(recovered, { ...saved, version: 1 });
  saveRoomSession(hostTab, recovered);
  assert.equal(hostTab.getItem('wizard-host'), null);
  const guestTab = storage(); guestTab.setItem('wizard-last-room', saved.room);
  assert.deepEqual(readRoomSession(guestTab), { version: 1, role: 'guest', room: saved.room, me: '' });
});

test('corrupt JSON and incomplete snapshots fall back safely to the home screen', () => {
  const tab = storage();
  for (const raw of ['{bad', 'null', JSON.stringify({ version: 1, role: 'host', room: 'ABCD2345', me: 'host', game: {} })]) {
    tab.setItem(ROOM_SESSION_KEY, raw);
    assert.equal(readRoomSession(tab), null);
    assert.equal(tab.getItem(ROOM_SESSION_KEY), null);
  }
});

test('practice is recoverable, while leave and removal clear all versions of the room snapshot', () => {
  const tab = storage(), saved = { ...hostSession(), role: 'practice', room: '离线练习' };
  assert.equal(saveRoomSession(tab, saved), true);
  assert.equal(readRoomSession(tab).role, 'practice');
  tab.setItem('wizard-host', 'old'); tab.setItem('wizard-last-room', 'ABCD2345');
  tab.setItem('wizard-player-token', 'keep-this-identity');
  clearRoomSession(tab);
  assert.equal(readRoomSession(tab), null);
  assert.equal(tab.getItem('wizard-player-token'), 'keep-this-identity');
});

test('unavailable or full browser storage does not crash the game', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); }, removeItem() { throw Error('blocked'); } };
  assert.equal(saveRoomSession(blocked, hostSession()), false);
  assert.equal(readRoomSession(blocked), null);
  assert.doesNotThrow(() => clearRoomSession(blocked));
});
