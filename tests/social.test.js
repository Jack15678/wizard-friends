import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { trumpStyle, TRUMP_COLORS } from '../src/trump-style.js';
import { DEFAULT_OPTIONS } from '../src/rules-vote.js';
function room() {
  const game = createGame();
  addPlayer(game, 'host', '房主');
  addPlayer(game, 'guest', '朋友');
  addPlayer(game, 'bot', '机器人', true);
  return game;
}
function start(game) {
  act(game, 'host', { type: 'beginVote' });
  for (const id of ['host', 'guest']) act(game, id, { type: 'vote', choices: { ...DEFAULT_OPTIONS, short: true } });
  act(game, 'host', { type: 'start' });
}
test('rename is authenticated, self-only, validated, and independent of turn', () => {
  const game = room();
  act(game, 'guest', { type: 'rename', name: '  新名字  ', player: 'host' });
  assert.equal(game.players[1].name, '新名字');
  assert.equal(game.players[0].name, '房主');
  start(game);
  act(game, 'guest', { type: 'rename', name: '开局后改名' });
  assert.equal(viewFor(game, 'host').players[1].name, '开局后改名');
  for (const name of ['', ' ', 'a'.repeat(17), '换\n行', null]) {
    assert.throws(() => act(game, 'guest', { type: 'rename', name }));
  }
  for (const actor of ['outsider', 'bot']) assert.throws(() => act(game, actor, { type: 'rename', name: '伪装' }));
  game.players[1].online = false;
  assert.throws(() => act(game, 'guest', { type: 'rename', name: '离线' }));
});
test('chat uses authoritative identity, preserves send-time name and does not change game play', () => {
  const game = room();
  start(game);
  const before = structuredClone(game);
  act(game, 'guest', { type: 'chat', text: '<b>你好</b>', name: '房主', player: 'host' });
  assert.equal(game.chat[0].player, 'guest');
  assert.equal(game.chat[0].name, '朋友');
  assert.equal(game.chat[0].text, '<b>你好</b>');
  const { chat, chatSeq, ...rest } = game;
  assert.deepEqual(rest, before);
  assert.deepEqual(viewFor(game, 'host').chat, chat);
  act(game, 'guest', { type: 'rename', name: '新名字' });
  assert.equal(game.chat[0].name, '朋友');
  for (const text of ['', ' ', 'x'.repeat(301), {}]) assert.throws(() => act(game, 'guest', { type: 'chat', text }));
  assert.throws(() => act(game, 'outsider', { type: 'chat', text: '非法消息' }));
});
test('chat limits bursts and retains only the latest 100 messages', t => {
  const game = room();
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  for (let i = 0; i < 5; i++) act(game, 'guest', { type: 'chat', text: String(i) });
  assert.throws(() => act(game, 'guest', { type: 'chat', text: 'too fast' }));
  for (let i = 0; i < 105; i++) {
    now += 5001;
    act(game, 'guest', { type: 'chat', text: String(i) });
  }
  assert.equal(game.chat.length, 100);
  assert.equal(game.chatSeq, 110);
  assert.equal(game.chat[0].seq, 11);
});
test('host rejects manual duplicate names including offline and bot seats, regenerates automatic names', () => {
  const game = room();
  game.players[1].online = false;
  assert.throws(() => addPlayer(game, 'new', '朋友'), /已被使用/);
  assert.throws(() => act(game, 'host', { type: 'rename', name: '机器人' }), /已被使用/);
  assert.throws(() => act(game, 'host', { type: 'rename', name: '朋友' }), /已被使用/);
  addPlayer(game, 'auto', '朋友', false, true);
  addPlayer(game, 'empty', '', false, true);
  assert.equal(new Set(game.players.map(p => p.name)).size, game.players.length);
  assert.equal(game.players.find(p => p.id === 'auto').automaticName, true);
  act(game, 'auto', { type: 'rename', name: '换个新名' });
  assert.equal(game.players.find(p => p.id === 'auto').automaticName, false);
});
test('automatic bot names remain unique across removal and replacement', () => {
  const game = room();
  for (let i = 0; i < 12; i++) {
    const id = `bot${i}`;
    addPlayer(game, id, '机器人', true, true);
    assert.equal(new Set(game.players.map(p => p.name)).size, game.players.length);
    game.players = game.players.filter(p => p.id !== id);
  }
});
test('all trump colors, white no-trump, and pending selection are distinct states', () => {
  for (const suit of ['blue', 'red', 'green', 'yellow']) {
    assert.deepEqual(trumpStyle({ trump: suit, phase: 'bid' }), { suit, color: TRUMP_COLORS[suit], pending: false });
  }
  assert.deepEqual(trumpStyle({ trump: null, phase: 'bid' }), { suit: 'none', color: '#ffffff', pending: false });
  assert.equal(trumpStyle({ trump: null, phase: 'trump' }).pending, true);
});
