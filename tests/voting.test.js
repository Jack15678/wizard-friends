import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, viewFor, botAction } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-vote.js';

function room(count = 3, humans = count) {
  const g = createGame();
  for (let i = 0; i < count; i++) addPlayer(g, `p${i}`, `玩家${i}`, i >= humans);
  return g;
}
const vote = (g, id, options = {}) => act(g, id, { type: 'vote', choices: { ...DEFAULT_OPTIONS, ...options } });
function finishRound(g) {
  let steps = 0;
  while (!['roundEnd', 'finished'].includes(g.phase) && steps++ < 1000) {
    if (g.phase === 'trickEnd') act(g, 'p0', { type: 'next' });
    else {
      const player = g.players.find(p => viewFor(g, p.id).canBid) ?? g.players[g.turn];
      const wasBot = player.bot;
      player.bot = true;
      const action = botAction(g, player.id);
      player.bot = wasBot;
      assert.ok(action);
      act(g, player.id, action);
    }
  }
  assert.ok(['roundEnd', 'finished'].includes(g.phase));
}

test('starting requires all humans to vote and host to explicitly deal approved rules', () => {
  const g = room(3, 2);
  assert.throws(() => act(g, 'p0', { type: 'start', short: true }));
  assert.throws(() => act(g, 'p1', { type: 'beginVote' }));
  act(g, 'p0', { type: 'beginVote' });
  assert.equal(g.phase, 'rules');
  assert.equal(g.round, 0);
  assert.equal(viewFor(g, 'p0').vote.targetRound, 1);
  assert.ok(g.players.every(p => p.hand.length === 0));
  vote(g, 'p1', { short: true });
  assert.throws(() => act(g, 'p0', { type: 'start' }));
  assert.throws(() => vote(g, 'p2', { short: true }));
  assert.throws(() => vote(g, 'outsider', { short: true }));
  vote(g, 'p0', { short: true });
  assert.equal(viewFor(g, 'p0').vote.complete, true);
  assert.equal(g.phase, 'rules');
  assert.equal(g.options.short, false);
  assert.equal(viewFor(g, 'p0').vote.resolved.short, true);
  assert.throws(() => act(g, 'p1', { type: 'start' }));
  act(g, 'p0', { type: 'start', short: false, deckMode: 'mono' });
  assert.equal(g.options.short, true);
  assert.equal(g.options.deckMode, 'standard');
  assert.equal(g.maxRounds, 5);
  assert.equal(g.round, 1);
});

test('votes disclose progress and own choices only; invalid and repeated submission cannot change ballot', () => {
  const g = room();
  act(g, 'p0', { type: 'beginVote' });
  const invalid = [{}, null, [], { ...DEFAULT_OPTIONS, strict: 1 }, { ...DEFAULT_OPTIONS, surprise: true }];
  for (const choices of invalid) assert.throws(() => act(g, 'p1', { type: 'vote', choices }));
  vote(g, 'p1', { deckMode: 'mono', predictionMode: 'secret' });
  const before = JSON.stringify(g);
  assert.throws(() => vote(g, 'p1'));
  assert.equal(JSON.stringify(g), before);
  const own = viewFor(g, 'p1').vote;
  assert.equal(own.round, 1);
  assert.equal(own.ownChoices.deckMode, 'mono');
  const other = JSON.parse(JSON.stringify(viewFor(g, 'p0')));
  assert.deepEqual(other.vote.submitted, ['p1']);
  assert.equal(other.vote.ownChoices, null);
  assert.deepEqual(other.vote.resolved, {});
  assert.ok(!('ballots' in other.vote));
  assert.ok(!JSON.stringify(other).includes('"p1":{"'));
  assert.deepEqual(other.log, []);
});

test('plurality wins per category; only tied candidates revote and completed categories stay fixed', () => {
  const g = room(4);
  act(g, 'p0', { type: 'beginVote' });
  vote(g, 'p0', { short: true, foresight: true, predictionMode: 'secret' });
  vote(g, 'p1', { short: true, foresight: true, predictionMode: 'secret' });
  vote(g, 'p2', { predictionMode: 'hidden' });
  vote(g, 'p3');
  let v = viewFor(g, 'p0').vote;
  assert.equal(v.round, 2);
  assert.deepEqual(Object.keys(v.pending).sort(), ['foresight', 'short']);
  assert.equal(v.resolved.predictionMode, 'secret');
  assert.equal(v.resolved.strict, false);
  assert.deepEqual(v.submitted, []);
  assert.throws(() => vote(g, 'p0'), /有效选项/);
  for (const p of g.players) act(g, p.id, { type: 'vote', choices: { short: true, foresight: true } });
  v = viewFor(g, 'p0').vote;
  assert.equal(v.complete, true);
  assert.equal(v.resolved.predictionMode, 'secret');
  assert.equal(v.resolved.short, true);
  assert.equal(v.resolved.foresight, true);
  assert.deepEqual(g.options, DEFAULT_OPTIONS);
});

test('prediction tie narrows candidates, and resolving nonpublic removes strict tie', () => {
  const g = room(4);
  act(g, 'p0', { type: 'beginVote' });
  for (let i = 0; i < 4; i++) vote(g, `p${i}`, { predictionMode: i < 2 ? 'hidden' : 'secret', strict: i < 2 });
  let v = viewFor(g, 'p0').vote;
  assert.deepEqual(v.pending.predictionMode, ['hidden', 'secret']);
  assert.deepEqual(v.pending.strict, [false, true]);
  const before = JSON.stringify(g);
  assert.throws(() => act(g, 'p0', { type: 'vote', choices: { predictionMode: 'public', strict: false } }));
  assert.equal(JSON.stringify(g), before);
  for (let i = 0; i < 4; i++) act(g, `p${i}`, { type: 'vote', choices: { predictionMode: 'hidden', strict: i < 2 } });
  v = viewFor(g, 'p0').vote;
  assert.equal(v.complete, true);
  assert.equal(v.resolved.strict, false);
});

test('nonpublic winner discards tied strict votes without a redundant revote', () => {
  const g = room(4);
  act(g, 'p0', { type: 'beginVote' });
  for (let i = 0; i < 4; i++) vote(g, `p${i}`, { predictionMode: 'hidden', strict: i < 2 });
  assert.equal(viewFor(g, 'p0').vote.complete, true);
  assert.equal(g.options.strict, false);
});

test('offline players pause the vote and deal; reconnect preserves submitted choices', () => {
  const g = room();
  g.players[2].online = false;
  assert.throws(() => act(g, 'p0', { type: 'beginVote' }));
  g.players[2].online = true;
  act(g, 'p0', { type: 'beginVote' });
  vote(g, 'p1');
  g.players[2].online = false;
  assert.throws(() => vote(g, 'p0'));
  assert.throws(() => vote(g, 'p2'));
  assert.deepEqual(viewFor(g, 'p1').vote.ownChoices, DEFAULT_OPTIONS);
  g.players[2].online = true;
  vote(g, 'p0');
  vote(g, 'p2');
  g.players[2].online = false;
  assert.throws(() => act(g, 'p0', { type: 'start' }));
  g.players[2].online = true;
  act(g, 'p0', { type: 'start' });
  assert.equal(g.round, 1);
});

test('vote freezes seats; host may cancel offline vote then begin a fresh vote', () => {
  const g = room();
  act(g, 'p0', { type: 'beginVote' });
  vote(g, 'p0', { foresight: true });
  assert.throws(() => addPlayer(g, 'extra', '新朋友'));
  assert.throws(() => act(g, 'p1', { type: 'cancelVote' }));
  g.players[2].online = false;
  act(g, 'p0', { type: 'cancelVote' });
  assert.equal(g.phase, 'lobby');
  assert.equal(g.vote, undefined);
  g.players = g.players.filter(p => p.online);
  addPlayer(g, 'extra', '新朋友');
  act(g, 'p0', { type: 'beginVote' });
  assert.deepEqual(viewFor(g, 'p0').vote.submitted, []);
  assert.equal(viewFor(g, 'p0').vote.round, 1);
});

for (const count of [5, 6]) test(`${count} players cannot choose mono, including crafted ballots`, () => {
  const g = room(count, 1);
  act(g, 'p0', { type: 'beginVote' });
  assert.deepEqual(viewFor(g, 'p0').vote.pending.deckMode, ['standard']);
  assert.throws(() => vote(g, 'p0', { deckMode: 'mono' }));
  vote(g, 'p0');
  act(g, 'p0', { type: 'start' });
  assert.equal(g.options.deckMode, 'standard');
});

test('practice vote excludes bots, and rematch preserves members and chat while requiring new vote', () => {
  const g = room(3, 1);
  act(g, 'p0', { type: 'chat', text: '下一局见' });
  act(g, 'p0', { type: 'beginVote' });
  vote(g, 'p0', { deckMode: 'mono', foresight: true });
  assert.equal(viewFor(g, 'p0').vote.complete, true);
  act(g, 'p0', { type: 'start' });
  assert.throws(() => act(g, 'p0', { type: 'rematch' }));
  g.phase = 'finished';
  g.players.forEach(p => { p.score = 99; });
  const members = g.players.map(({ id, name, bot, automaticName }) => ({ id, name, bot, automaticName }));
  act(g, 'p0', { type: 'rematch' });
  assert.deepEqual(g.players.map(({ id, name, bot, automaticName }) => ({ id, name, bot, automaticName })), members);
  assert.equal(g.chat[0].text, '下一局见');
  assert.equal(g.phase, 'lobby');
  assert.equal(g.round, 0);
  assert.deepEqual(g.history, []);
  assert.ok(g.players.every(p => p.score === 0 && p.bid === null && p.hand.length === 0 && p.monoSuit === undefined));
  assert.throws(() => act(g, 'p0', { type: 'start' }));
  act(g, 'p0', { type: 'beginVote' });
  assert.deepEqual(viewFor(g, 'p0').vote.resolved, {});
});

test('later-round vote locks deck and length; ties, disconnects and cancellation do not change scores, options or dealer', () => {
  const g = room(4, 2);
  act(g, 'p0', { type: 'chat', text: '这局一起玩' });
  act(g, 'p0', { type: 'beginVote' });
  for (const id of ['p0', 'p1']) vote(g, id, { deckMode: 'mono', short: true, strict: true });
  act(g, 'p0', { type: 'start' });
  finishRound(g);
  const settled = structuredClone(g);
  const preserved = () => {
    for (const key of ['round', 'dealer', 'maxRounds', 'options', 'history', 'chat', 'players', 'log']) {
      assert.deepEqual(g[key], settled[key], `${key} must not change before dealing`);
    }
  };
  g.players[1].online = false;
  assert.throws(() => act(g, 'p0', { type: 'next' }));
  g.players[1].online = true;
  act(g, 'p0', { type: 'next' });
  preserved();
  assert.equal(g.phase, 'rules');
  assert.equal(g.vote.targetRound, 2);
  assert.deepEqual(g.vote.resolved, { deckMode: 'mono', short: true });
  assert.deepEqual(Object.keys(g.vote.pending).sort(), ['foresight', 'predictionMode', 'strict']);
  assert.throws(() => addPlayer(g, 'extra', '加塞'));
  for (const extra of [{ deckMode: 'standard' }, { short: false }]) {
    assert.throws(() => act(g, 'p0', { type: 'vote', choices: { predictionMode: 'hidden', strict: true, foresight: true, ...extra } }));
  }
  act(g, 'p0', { type: 'vote', choices: { predictionMode: 'hidden', strict: true, foresight: true } });
  act(g, 'p1', { type: 'vote', choices: { predictionMode: 'secret', strict: false, foresight: true } });
  assert.equal(g.vote.round, 2);
  assert.equal(g.vote.targetRound, 2);
  assert.deepEqual(g.vote.resolved, { deckMode: 'mono', short: true, foresight: true });
  preserved();
  act(g, 'p0', { type: 'vote', choices: { predictionMode: 'secret', strict: true } });
  g.players[1].online = false;
  assert.throws(() => act(g, 'p1', { type: 'vote', choices: { predictionMode: 'secret', strict: false } }));
  assert.deepEqual(viewFor(g, 'p0').vote.ownChoices, { predictionMode: 'secret', strict: true });
  act(g, 'p0', { type: 'cancelVote' });
  assert.equal(g.phase, 'roundEnd');
  assert.throws(() => addPlayer(g, 'extra', '加塞'));
  g.players[1].online = true;
  preserved();
  act(g, 'p0', { type: 'next' });
  assert.equal(g.vote.round, 1);
  assert.equal(g.vote.targetRound, 2);
  for (const id of ['p0', 'p1']) act(g, id, { type: 'vote', choices: { predictionMode: 'secret', strict: true, foresight: true } });
  assert.equal(viewFor(g, 'p0').vote.complete, true);
  assert.equal(g.vote.resolved.strict, false);
  preserved();
  // Cancelling even a fully resolved vote leaves the previous round's rules intact.
  act(g, 'p0', { type: 'cancelVote' });
  preserved();
  act(g, 'p0', { type: 'next' });
  for (const id of ['p0', 'p1']) act(g, id, { type: 'vote', choices: { predictionMode: 'secret', strict: true, foresight: true } });
  act(g, 'p0', { type: 'start' });
  assert.equal(g.round, 2);
  assert.equal(g.dealer, 1);
  assert.equal(g.maxRounds, 5);
  assert.equal(g.options.predictionMode, 'secret');
  assert.equal(g.options.strict, false);
  assert.deepEqual(g.players.map(p => p.monoSuit), settled.players.map(p => p.monoSuit));
  assert.deepEqual(g.history, settled.history);
  assert.deepEqual(g.chat, settled.chat);
  assert.throws(() => act(g, 'p0', { type: 'start' }));
  assert.equal(g.round, 2);
  assert.equal(g.dealer, 1);
  finishRound(g);
  assert.deepEqual(g.history[0].options, settled.options);
  assert.equal(g.history[1].options.predictionMode, 'secret');
  assert.equal(g.history[1].options.foresight, true);
  act(g, 'p0', { type: 'next' });
  assert.equal(g.vote.targetRound, 3);
  assert.deepEqual(viewFor(g, 'p0').players.map(p => p.bid), g.history[1].result.map(p => p.bid));
});
