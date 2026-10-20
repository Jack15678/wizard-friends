import test from 'node:test';
import assert from 'node:assert/strict';
import { deck, shuffled, winner, legalCards, leadSuit, points, createGame, addPlayer, act, viewFor, allowedBids, botAction } from '../src/game.js';
const n = (suit, rank) => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
const w = { id: 'wizard-0', kind: 'wizard' }, j = { id: 'jester-0', kind: 'jester' };
const trick = (...cards) => cards.map((card, player) => ({ player, card }));
function setup(count = 3) {
  const g = createGame();
  for (let i = 0; i < count; i++) addPlayer(g, `p${i}`, `玩家${i}`, true);
  return g;
}
test('60 unique cards and immutable shuffle', () => {
  const cards = deck(); assert.equal(new Set(cards.map(c => c.id)).size, 60);
  const copy = shuffled(cards); assert.deepEqual(cards, deck()); assert.deepEqual(copy.map(c => c.id).sort(), cards.map(c => c.id).sort());
});
test('first wizard, trump, lead suit, all jesters', () => {
  assert.equal(winner(trick(j, w, { ...w, id: 'wizard-1' }), 'red'), 1);
  assert.equal(winner(trick(n('blue', 13), n('red', 1), n('green', 13)), 'red'), 1);
  assert.equal(winner(trick(n('blue', 2), n('red', 13), n('blue', 9)), null), 2);
  assert.equal(winner(trick(j, j, j), null), 0);
});
test('jester and wizard lead edge cases; a later wizard does not cancel follow suit', () => {
  const hand = [n('red', 1), n('blue', 3), w, j];
  assert.equal(leadSuit(trick(j, w, n('red', 4))), null);
  assert.equal(legalCards(hand, trick(j, w, n('red', 4))).length, 4);
  assert.equal(leadSuit(trick(j, n('red', 4), w)), 'red');
  assert.deepEqual(legalCards(hand, trick(n('red', 4), w)).map(c => c.id), ['red-1', 'wizard-0', 'jester-0']);
  assert.equal(legalCards([n('blue', 1)], trick(n('red', 4))).length, 1);
});
test('exact bids and penalties including zero', () => {
  assert.equal(points(0, 0), 20); assert.equal(points(3, 3), 50);
  assert.equal(points(0, 3), -30); assert.equal(points(3, 0), -30);
});
test('reject unauthorized actions and malformed bids; no state mutation', () => {
  const g = setup(); assert.throws(() => act(g, 'p1', { type: 'start' }));
  act(g, 'p0', { type: 'start' }, () => 0.5);
  if (g.phase === 'trump') act(g, g.players[g.turn].id, { type: 'trump', suit: 'red' });
  const before = JSON.stringify(g);
  assert.throws(() => act(g, 'intruder', { type: 'bid', value: 0 }));
  for (const value of [-1, 2, NaN, '0', 0.5, null]) assert.throws(() => act(g, g.players[g.turn].id, { type: 'bid', value }));
  assert.equal(JSON.stringify(g), before);
});
test('strict bids prevent matching total only for the last bidder', () => {
  const g = setup(); g.options.strict = true; g.round = 3;
  g.players[0].bid = 1; g.players[1].bid = 1;
  assert.deepEqual(allowedBids(g), [0, 2, 3]);
  g.options.strict = false; assert.deepEqual(allowedBids(g), [0, 1, 2, 3]);
});
test('views never transmit opponents hands or private deck', () => {
  const g = setup(); act(g, 'p0', { type: 'start' });
  const v = viewFor(g, 'p1');
  assert.ok(v.players[1].hand); assert.equal(v.players[0].hand, undefined);
  assert.equal(v.players[2].hand, undefined); assert.equal(v.players[0].count, 1);
  assert.ok(!('deck' in v));
});
test('illegal off-suit play cannot alter hand', () => {
  const g = setup(); g.phase = 'play'; g.turn = 1; g.round = 2;
  g.trick = trick(n('red', 4)); g.players[1].hand = [n('red', 2), n('blue', 13)];
  assert.throws(() => act(g, 'p1', { type: 'play', card: 'blue-13' }));
  assert.equal(g.players[1].hand.length, 2);
});
test('limits, names, and late joins', () => {
  const g = setup(6); assert.throws(() => addPlayer(g, 'extra', '额外玩家'));
  assert.throws(() => addPlayer(createGame(), 'p', ''));
  const small = setup(2); assert.throws(() => act(small, 'p0', { type: 'start' }));
  act(g, 'p0', { type: 'start' }); assert.throws(() => addPlayer(g, 'extra', '额外玩家'));
});
for (const count of [3, 4, 5, 6]) for (const strict of [false, true]) {
  test(`complete ${count}-player standard game, strict=${strict}`, () => {
    const g = setup(count); act(g, 'p0', { type: 'start', strict });
    let steps = 0;
    while (g.phase !== 'finished' && steps++ < 10000) {
      if (['trickEnd', 'roundEnd'].includes(g.phase)) act(g, 'p0', { type: 'next' });
      else act(g, g.players[g.turn].id, botAction(g));
      if (['roundEnd', 'finished'].includes(g.phase)) {
        assert.equal(g.players.reduce((s,p) => s + p.won, 0), g.round);
        assert.ok(g.players.every(p => p.hand.length === 0));
        if (strict) assert.notEqual(g.players.reduce((s,p) => s + p.bid, 0), g.round);
      }
    }
    assert.equal(g.phase, 'finished');
    assert.equal(g.round, 60 / count);
    assert.equal(g.trump, null);
    assert.equal(g.reveal, null);
    for (const p of g.players) assert.equal(p.score, g.history.reduce((s,h) => s + h.result.find(r => r.id === p.id).delta, 0));
  });
}
