import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, spectatorView } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-vote.js';
import { applyPublicAction, appendPublicEvent } from '../src/spectator-events.js';

function start(predictionMode = 'public') {
  const game = createGame();
  for (let i = 0; i < 3; i++) addPlayer(game, `p${i}`, `玩家${i}`, i > 0);
  act(game, 'p0', { type: 'beginVote' });
  act(game, 'p0', { type: 'vote', choices: { ...DEFAULT_OPTIONS, predictionMode, short: true } });
  act(game, 'p0', { type: 'start' }, () => .5);
  game.players.forEach(player => { player.bot = false; });
  if (game.phase === 'trump') applyPublicAction(game, game.players[game.turn].id, { type: 'trump', suit: 'blue' });
  return game;
}

for (const mode of ['hidden', 'secret']) test(`${mode} prediction submissions never publish a locked numeric value in the event stream`, () => {
  const game = start(mode);
  applyPublicAction(game, 'p0', { type: 'bid', value: 1 });
  assert.equal(game.publicEvents.at(-1).text, '玩家0 已提交预估');
  assert.ok(!JSON.stringify(spectatorView(game).publicEvents).includes('预估 1 墩'));
  applyPublicAction(game, 'p1', { type: 'bid', value: 1 });
  applyPublicAction(game, 'p2', { type: 'bid', value: 0 });
  assert.equal(spectatorView(game).players[0].bid, mode === 'secret' ? null : 1);
  if (mode === 'secret') assert.ok(game.publicEvents.every(event => !/预估 \d/.test(event.text)));
});

test('public card plays, winning seat and round scoring are retained for a late spectator', () => {
  const game = start();
  game.phase = 'play'; game.turn = 0; game.trump = null; game.completedTricks = 0; game.trick = [];
  game.players.forEach((player, index) => {
    player.bid = index === 2 ? 1 : 0;
    player.hand = [index === 2 ? { id: 'wizard-0', kind: 'wizard' } : { id: `blue-${index + 2}`, suit: 'blue', kind: 'number', rank: index + 2 }];
  });
  for (let index = 0; index < 3; index++) applyPublicAction(game, `p${index}`, { type: 'play', card: game.players[index].hand[0].id });
  const events = spectatorView(game).publicEvents.map(event => event.text);
  assert.ok(events.includes('玩家0 出牌：蓝 2'));
  assert.ok(events.includes('玩家1 出牌：蓝 3'));
  assert.ok(events.includes('玩家2 出牌：巫师 W'));
  assert.ok(events.includes('玩家2 赢下第 1 墩'));
  assert.ok(events.some(event => event.startsWith('第 1 轮结算：')));
});

test('rejected actions leave the public event stream and game unchanged', () => {
  const game = start(); const before = structuredClone(game);
  assert.throws(() => applyPublicAction(game, 'unseated-watcher', { type: 'play', card: 'wizard-0' }));
  assert.deepEqual(game, before);
});

test('public activity retention and message length are bounded', () => {
  const game = start();
  for (let index = 0; index < 120; index++) appendPublicEvent(game, `${index}:` + 'a'.repeat(400));
  assert.equal(game.publicEvents.length, 100);
  assert.equal(game.publicEvents.at(-1).seq, game.publicEventSeq);
  assert.ok(game.publicEvents.every(event => event.text.length <= 300));
});
