import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, viewFor, spectatorView, botAction, TURN_MS, points } from '../src/game.js';
const card = (suit, rank) => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
function playing() {
  const g = createGame();
  for (let i = 0; i < 3; i++) addPlayer(g, `p${i}`, `玩家${i}`, i > 0);
  Object.assign(g, { phase: 'play', round: 1, cardsPerRound: 1, maxRounds: 1, completedTricks: 0 });
  for (let i = 0; i < 3; i++) Object.assign(g.players[i], { hand: [card('blue', i + 1)], bid: i === 2 ? 1 : 0 });
  return g;
}
test('typed events have unique monotonic IDs and score only once with injected clock', () => {
  const g = playing();
  act(g, 'p0', { type: 'play', card: 'blue-1' }, undefined, 1000);
  assert.equal(g.turnDeadline, 1000 + TURN_MS);
  act(g, 'p1', { type: 'play', card: 'blue-2' }, undefined, 2000);
  act(g, 'p2', { type: 'play', card: 'blue-3' }, undefined, 3000);
  assert.equal(g.phase, 'finished');
  assert.deepEqual(g.events.filter(event => event.type === 'play').map(event => event.trick), [1, 1, 1]);
  assert.equal(g.events.filter(event => event.type === 'trickEnd').length, 1);
  assert.equal(g.events.filter(event => event.type === 'roundEnd').length, 1);
  assert.deepEqual(g.events.map(event => event.seq), Array.from({ length: g.eventSeq }, (_, i) => i + 1));
  assert.deepEqual(g.history[0].result.map(result => result.delta), [20, 20, 30]);
  assert.deepEqual(viewFor(g, 'p0').events, spectatorView(g).events);
  const seq = g.eventSeq, totals = g.players.map(player => player.score);
  act(g, 'p0', { type: 'chat', text: '结束了' }, undefined, 4000);
  assert.equal(g.chat[0].time, 4000);
  assert.equal(g.eventSeq, seq);
  assert.deepEqual(g.players.map(player => player.score), totals);
  assert.throws(() => act(g, 'p2', { type: 'play', card: 'blue-3' }, undefined, 4001));
});
test('engine pause guard freezes gameplay without stopping chat or corrupting chosen cards', () => {
  const g = playing();
  g.paused = true;
  const before = structuredClone(g);
  assert.throws(() => act(g, 'p0', { type: 'play', card: 'blue-1' }, undefined, 1000), /暂停/);
  assert.deepEqual(g, before);
  act(g, 'p0', { type: 'chat', text: '稍等' }, undefined, 5000);
  assert.equal(g.chat[0].time, 5000);
  assert.equal(g.turnDeadline, undefined);
});
test('fresh match obtains a new private stream while public event cursor never moves backwards', () => {
  const g = playing(), stream = structuredClone(g.randomState);
  for (let i = 0; i < 3; i++) act(g, `p${i}`, { type: 'play', card: `blue-${i + 1}` });
  const seq = g.eventSeq;
  act(g, 'p0', { type: 'rematch' });
  assert.ok(g.eventSeq > seq);
  assert.notDeepEqual(g.randomState, stream);
  assert.equal(g.players[0].score, 0);
});
test('smart and simple bots obey legality and target-aware strategy at the last seat', () => {
  const g = playing();
  Object.assign(g, { cardsPerRound: 2, maxRounds: 2, turn: 2, trick: [
    { player: 0, card: card('blue', 7) }, { player: 1, card: card('blue', 8) },
  ] });
  Object.assign(g.players[2], { won: 0, bid: 2, hand: [card('blue', 3), card('blue', 13)] });
  assert.equal(botAction(g, 'p2').card, 'blue-13');
  g.players[2].bid = 0;
  assert.equal(botAction(g, 'p2').card, 'blue-3');
  for (const difficulty of ['simple', 'smart']) assert.ok(viewFor(g, 'p2').legal.includes(botAction(g, 'p2', difficulty).card));
  g.players[2].botDifficulty = 'simple';
  assert.deepEqual(botAction(g, 'p2'), botAction(g, 'p2', 'simple'));
  const randomBefore = structuredClone(g.randomState);
  botAction(g, 'p2', 'smart');
  assert.deepEqual(g.randomState, randomBefore);
  assert.equal(points(0, 0), 20);
});
