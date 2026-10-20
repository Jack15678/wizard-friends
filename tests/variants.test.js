import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, viewFor, botAction, winner, monoDeck, allowedBids, normalizeGame } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-vote.js';

function start(options = {}, count = 3) {
  const g = createGame();
  for (let i = 0; i < count; i++) addPlayer(g, `p${i}`, `玩家${i}`, i > 0);
  act(g, 'p0', { type: 'beginVote' });
  act(g, 'p0', { type: 'vote', choices: { ...DEFAULT_OPTIONS, ...options } });
  act(g, 'p0', { type: 'start' }, () => 0.5);
  g.players[0].bot = true;
  return g;
}
function enterBid(g) {
  if (g.phase === 'trump') act(g, g.players[g.turn].id, { type: 'trump', suit: 'red' });
  assert.equal(g.phase, 'bid');
}
function advanceRound(g, options = {}) {
  const nextOptions = { ...g.options, ...options };
  g.players[0].bot = false;
  act(g, 'p0', { type: 'next' });
  const choices = Object.fromEntries(Object.keys(g.vote.pending).map(key => [key, nextOptions[key]]));
  act(g, 'p0', { type: 'vote', choices });
  act(g, 'p0', { type: 'start' }, () => 0.37);
  g.players[0].bot = true;
}
function step(g) {
  if (g.phase === 'roundEnd') return advanceRound(g);
  if (g.phase === 'trickEnd') return act(g, 'p0', { type: 'next' });
  const pending = g.players.map(p => ({ id: p.id, action: botAction(g, p.id) })).find(x => x.action);
  assert.ok(pending, `no bot action in ${g.phase}`);
  act(g, pending.id, pending.action);
}
const n = (suit, rank) => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
const trick = (...cards) => cards.map((card, player) => ({ player, card }));

test('single-color deck contains 13 numbers, one wizard and one jester; equal numbers favor first', () => {
  const cards = monoDeck('blue');
  assert.equal(cards.length, 15);
  assert.equal(new Set(cards.map(c => c.id)).size, 15);
  assert.equal(cards.filter(c => c.kind === 'number' && c.suit === 'blue').length, 13);
  assert.equal(winner(trick(n('blue', 2), n('red', 13), n('green', 13)), null, 'mono'), 1);
  assert.equal(winner(trick(n('blue', 13), { kind: 'wizard' }, { kind: 'wizard' }), null, 'mono'), 1);
  assert.equal(winner(trick({ kind: 'jester' }, { kind: 'jester' }), null, 'mono'), 0);
});

test('mono deals unique suits with four initial cards, no trump, and strict counts cards not round number', () => {
  const g = start({ deckMode: 'mono', strict: true }, 4);
  assert.equal(new Set(g.players.map(p => p.monoSuit)).size, 4);
  assert.equal(g.cardsPerRound, 4);
  assert.equal(g.round, 1);
  assert.equal(g.reveal, null);
  assert.equal(g.trump, null);
  assert.equal(g.phase, 'bid');
  assert.ok(g.players.every(p => p.hand.length === 4 && p.hand.every(c => c.kind !== 'number' || c.suit === p.monoSuit)));
  g.players[1].bid = 1; g.players[2].bid = 1; g.players[3].bid = 1;
  assert.deepEqual(allowedBids(g), [0, 2, 3, 4]);
});

for (const predictionMode of ['hidden', 'secret']) test(`${predictionMode} permits independent one-time bids without leaking others' values or logs`, () => {
  const g = start({ predictionMode, strict: true });
  enterBid(g);
  assert.equal(g.options.strict, false);
  assert.equal(g.turn, 1);
  assert.ok(g.players.every(p => viewFor(g, p.id).canBid));
  act(g, 'p0', { type: 'bid', value: 1 });
  assert.throws(() => act(g, 'p0', { type: 'bid', value: 0 }));
  assert.equal(viewFor(g, 'p0').players[0].bid, 1);
  const serialized = JSON.parse(JSON.stringify(viewFor(g, 'p1')));
  assert.equal(serialized.players[0].bid, null);
  assert.equal(serialized.players[0].bidSubmitted, true);
  assert.ok(!serialized.log.some(line => line.includes('预言 1 墩')));
  assert.equal(viewFor(g, 'p0').canBid, false);
  assert.deepEqual(viewFor(g, 'p0').bids, []);
  act(g, 'p2', { type: 'bid', value: 0 });
  act(g, 'p1', { type: 'bid', value: 0 });
  assert.equal(g.phase, 'play');
  assert.equal(viewFor(g, 'p1').players[0].bid, predictionMode === 'hidden' ? 1 : null);
  while (g.phase !== 'roundEnd') step(g);
  assert.equal(viewFor(g, 'p1').players[0].bid, 1);
  assert.equal(viewFor(g, 'p1').history[0].result[0].bid, 1);
  assert.ok(viewFor(g, 'p1').log.some(line => line.includes('预言 1 墩')));
});

test('secret digits stay concealed at intermediate trick end, become public only at round end', () => {
  const g = start({ deckMode: 'mono', predictionMode: 'secret' });
  for (const p of g.players) act(g, p.id, { type: 'bid', value: p.id === 'p0' ? 3 : 0 });
  while (g.phase !== 'trickEnd') step(g);
  assert.equal(g.completedTricks, 1);
  const v = JSON.parse(JSON.stringify(viewFor(g, 'p1')));
  assert.equal(v.players[0].bid, null);
  assert.ok(!v.log.some(line => line.includes('预言 3 墩')));
  assert.deepEqual(v.history, []);
  while (g.phase !== 'roundEnd') step(g);
  assert.equal(viewFor(g, 'p1').players[0].bid, 3);
});

for (const deckMode of ['standard', 'mono']) test(`foresight with ${deckMode} hides all own cards until everyone bids, then restores normal visibility`, () => {
  const g = start({ deckMode, foresight: true, strict: true });
  enterBid(g);
  const first = g.players[g.turn];
  const view = JSON.parse(JSON.stringify(viewFor(g, first.id)));
  assert.equal(view.foresightActive, true);
  assert.equal(view.players.find(p => p.id === first.id).hand, undefined);
  assert.equal(view.players.find(p => p.id === first.id).count, deckMode === 'mono' ? 4 : 1);
  assert.ok(view.players.filter(p => p.id !== first.id).every(p => p.hand.length === g.cardsPerRound));
  for (const c of first.hand) assert.ok(!JSON.stringify(view).includes(`"id":"${c.id}"`));
  step(g);
  assert.equal(viewFor(g, first.id).players.find(p => p.id === first.id).hand, undefined);
  while (g.phase === 'bid') step(g);
  const restored = viewFor(g, first.id);
  assert.equal(restored.foresightActive, false);
  assert.equal(restored.players.find(p => p.id === first.id).hand.length, g.cardsPerRound);
  assert.ok(restored.players.filter(p => p.id !== first.id).every(p => !('hand' in p)));
  while (g.phase !== 'roundEnd') step(g);
  step(g);
  assert.equal(g.round, 2);
  assert.equal(viewFor(g, first.id).foresightActive, true);
  assert.equal(viewFor(g, first.id).players.find(p => p.id === first.id).hand, undefined);
});

test('bots cannot base decisions on hidden own hand during foresight or other secret bids', () => {
  const g = start({ deckMode: 'mono', foresight: true, predictionMode: 'secret' });
  const before = botAction(g, 'p1');
  const original = g.players[1].hand;
  g.players[1].hand = [{ id: 'cheat-wizard', kind: 'wizard' }, { id: 'cheat-wizard-2', kind: 'wizard' }];
  assert.deepEqual(botAction(g, 'p1'), before);
  g.players[1].hand = original;
  while (g.phase === 'bid') step(g);
  const own = g.players[g.turn];
  const play = botAction(g, own.id);
  for (const p of g.players.filter(p => p.id !== own.id)) {
    p.bid = 999;
    p.hand = [{ id: 'hidden-card', kind: 'wizard' }];
  }
  assert.deepEqual(botAction(g, own.id), play);
});

for (const count of [3, 4]) for (const short of [false, true]) {
  for (const predictionMode of ['public', 'hidden', 'secret']) for (const foresight of [false, true]) {
    test(`complete mono count=${count} short=${short} prediction=${predictionMode} foresight=${foresight}`, () => {
      const g = start({ deckMode: 'mono', short, predictionMode, foresight, strict: true }, count);
      let steps = 0;
      const observedRounds = new Set([1]);
      while (g.phase !== 'finished' && steps++ < 10000) {
        step(g);
        if (!observedRounds.has(g.round)) {
          observedRounds.add(g.round);
          for (const p of g.players) {
            assert.equal(p.hand.length, g.round + 3);
            const ownDeck = monoDeck(p.monoSuit);
            assert.ok(p.hand.every(c => ownDeck.some(x => x.id === c.id)));
          }
        }
        if (['roundEnd', 'finished'].includes(g.phase)) {
          assert.equal(g.players.reduce((sum, p) => sum + p.won, 0), g.cardsPerRound);
          assert.ok(g.players.every(p => p.hand.length === 0));
          if (predictionMode === 'public') assert.notEqual(g.players.reduce((sum, p) => sum + p.bid, 0), g.cardsPerRound);
        }
      }
      assert.equal(g.phase, 'finished');
      assert.equal(g.round, short ? 5 : 12);
      assert.equal(g.cardsPerRound, short ? 8 : 15);
      assert.equal(g.history.length, g.round);
      assert.equal(g.trump, null);
      for (const p of g.players) assert.equal(p.score, g.history.reduce((sum, h) => sum + h.result.find(r => r.id === p.id).delta, 0));
    });
  }
}

for (const count of [3, 4, 5, 6]) for (const predictionMode of ['hidden', 'secret']) for (const short of [false, true]) {
  test(`complete standard count=${count} prediction=${predictionMode} short=${short} foresight=true`, () => {
    const g = start({ predictionMode, short, foresight: true }, count);
    let steps = 0;
    while (g.phase !== 'finished' && steps++ < 10000) step(g);
    assert.equal(g.phase, 'finished');
    assert.equal(g.history.length, short ? 5 : 60 / count);
  });
}

test('restoring legacy snapshot supplies defaults without restarting or altering cards and scores', () => {
  const legacy = start({ strict: true });
  delete legacy.cardsPerRound;
  delete legacy.rulesVersion;
  legacy.options = { short: false, strict: true };
  const before = structuredClone(legacy);
  const result = normalizeGame(legacy);
  assert.equal(result, legacy);
  assert.deepEqual(legacy.options, { ...DEFAULT_OPTIONS, strict: true });
  assert.equal(legacy.cardsPerRound, legacy.round);
  const { options, cardsPerRound, rulesVersion, ...restored } = legacy;
  assert.equal(rulesVersion, 2);
  const { options: oldOptions, ...original } = before;
  assert.deepEqual(restored, original);
  assert.notEqual(legacy.phase, 'rules');
  while (legacy.phase !== 'roundEnd') step(legacy);
  legacy.players[0].bot = false;
  act(legacy, 'p0', { type: 'next' });
  assert.equal(legacy.phase, 'rules');
  assert.equal(legacy.vote.targetRound, 2);
  assert.deepEqual(Object.keys(legacy.vote.pending).sort(), ['foresight', 'predictionMode', 'strict']);
});

test('legacy later-round foresight stays inactive on restore while current per-round selection remains active', () => {
  const current = start({ deckMode: 'mono', foresight: true });
  while (current.phase !== 'roundEnd') step(current);
  advanceRound(current);
  assert.equal(current.round, 2);
  assert.equal(viewFor(current, 'p0').foresightActive, true);
  const legacy = structuredClone(current);
  delete legacy.rulesVersion;
  const hand = structuredClone(legacy.players[0].hand);
  normalizeGame(legacy);
  assert.equal(legacy.rulesVersion, 2);
  assert.equal(legacy.options.foresight, false);
  assert.deepEqual(viewFor(legacy, 'p0').players[0].hand, hand);
  assert.equal(viewFor(legacy, 'p0').foresightActive, false);
  normalizeGame(current);
  assert.equal(current.options.foresight, true);
  assert.equal(viewFor(current, 'p0').players[0].hand, undefined);
  while (legacy.phase !== 'roundEnd') step(legacy);
  advanceRound(legacy, { foresight: true });
  assert.equal(legacy.round, 3);
  assert.equal(viewFor(legacy, 'p0').foresightActive, true);
});

for (const deckMode of ['standard', 'mono']) for (const predictionMode of ['hidden', 'secret']) {
  test(`${deckMode} switches public to ${predictionMode} on round two with foresight and switches it off on round three`, () => {
    const g = start({ deckMode, short: true, strict: true, foresight: false });
    while (g.phase !== 'roundEnd') step(g);
    const firstOptions = { ...g.options };
    advanceRound(g, { predictionMode, strict: true, foresight: true });
    enterBid(g);
    assert.equal(g.round, 2);
    assert.equal(g.options.strict, false);
    assert.equal(g.cardsPerRound, deckMode === 'mono' ? 5 : 2);
    const ownCards = g.players[0].hand.map(c => c.id);
    let visible = JSON.parse(JSON.stringify(viewFor(g, 'p0')));
    assert.equal(visible.foresightActive, true);
    assert.equal(visible.players[0].hand, undefined);
    assert.ok(visible.players.slice(1).every(p => p.hand.length === g.cardsPerRound));
    for (const id of ownCards) assert.ok(!JSON.stringify(visible).includes(`"id":"${id}"`));
    act(g, 'p1', { type: 'bid', value: 2 });
    visible = JSON.parse(JSON.stringify(viewFor(g, 'p0')));
    assert.equal(visible.players[1].bid, null);
    assert.equal(visible.players[1].bidSubmitted, true);
    assert.ok(!visible.log.some(line => line.includes('预言 2 墩')));
    while (g.phase === 'bid') step(g);
    visible = JSON.parse(JSON.stringify(viewFor(g, 'p0')));
    assert.equal(visible.foresightActive, false);
    assert.deepEqual(visible.players[0].hand.map(c => c.id), ownCards);
    assert.ok(visible.players.slice(1).every(p => !('hand' in p)));
    assert.equal(visible.players[1].bid, predictionMode === 'secret' ? null : 2);
    while (g.phase !== 'roundEnd') step(g);
    assert.deepEqual(g.history[0].options, firstOptions);
    assert.equal(g.history[1].options.predictionMode, predictionMode);
    assert.equal(g.history[1].options.foresight, true);
    advanceRound(g, { predictionMode: 'public', strict: true, foresight: false });
    enterBid(g);
    visible = viewFor(g, 'p0');
    assert.equal(g.round, 3);
    assert.equal(g.dealer, 2);
    assert.equal(g.options.strict, true);
    assert.equal(visible.foresightActive, false);
    assert.ok(visible.players[0].hand.length > 0);
    assert.ok(visible.players.slice(1).every(p => !('hand' in p)));
    assert.equal(g.players.filter(p => viewFor(g, p.id).canBid).length, 1);
  });
}
