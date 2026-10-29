import test from 'node:test';
import assert from 'node:assert/strict';
import { chacha20Block, createRandomStream, secureRandomSeed, nextRandomWord, uniformInteger, shuffle } from '../src/random.js';
import { createGame, addPlayer, act, deck, monoDeck, viewFor, spectatorView, normalizeGame } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-vote.js';

// RFC 8439 §2.3.2: full 64-byte block, represented as little-endian words.
test('ChaCha20 matches the complete RFC 8439 block-function test vector', () => {
  const key = [0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c, 0x13121110, 0x17161514, 0x1b1a1918, 0x1f1e1d1c];
  assert.deepEqual(chacha20Block(key, [0x09000000, 0x4a000000, 0], 1), [
    0xe4e7f110, 0x15593bd1, 0x1fdd0f50, 0xc47120a3, 0xc7f4d1c7, 0x0368c033, 0x9aaa2204, 0x4e6cd4c3,
    0x466482d2, 0x09aa9f07, 0x05d7c214, 0xa2028bd9, 0xd19c12b5, 0xb94e16de, 0xe883d0cb, 0x4e3c50a2,
  ]);
  // Independently published all-zero key/nonce stream prefix (RFC 8439 Appendix A.1).
  assert.deepEqual(chacha20Block(Array(8).fill(0), [0, 0, 0], 0).slice(0, 4), [0xade0b876, 0x903df1a0, 0xe56a5d40, 0x28bd8653]);
});

test('bounded rejection sampler handles high rejection interval and exact boundaries', () => {
  let calls = 0;
  const words = [0xffffffff, 0xfffffffe];
  assert.equal(uniformInteger(3, () => { calls++; return words.shift(); }), 3);
  assert.equal(calls, 2);
  assert.equal(uniformInteger(1, () => 0xffffffff), 1);
  assert.equal(uniformInteger(0x100000000, () => 0xffffffff), 0x100000000);
  assert.equal(uniformInteger(2, () => 0), 1);
  for (const max of [0, -1, 0.5, NaN, Infinity, 0x100000001]) assert.throws(() => uniformInteger(max, () => 0));
  for (const word of [-1, 1.5, NaN, Infinity, 0x100000000]) assert.throws(() => uniformInteger(6, () => word));
});

test('secure seeds fail closed and stream saves continue across buffered block boundaries', t => {
  const seed = secureRandomSeed();
  assert.equal(seed.length, 11);
  assert.ok(seed.every(value => Number.isInteger(value) && value >= 0 && value < 0x100000000));
  const stream = createRandomStream(Array.from({ length: 11 }, (_, i) => i));
  for (let i = 0; i < 19; i++) nextRandomWord(stream);
  const restored = JSON.parse(JSON.stringify(stream));
  assert.deepEqual(Array.from({ length: 64 }, () => nextRandomWord(stream)), Array.from({ length: 64 }, () => nextRandomWord(restored)));
  t.mock.method(crypto, 'getRandomValues', () => { throw Error('unavailable'); });
  assert.throws(() => createRandomStream(), /unavailable/);
});

test('invalid and exhausted random saves never silently reseed or wrap', () => {
  for (const seed of [[], Array(11).fill(-1), Array(11).fill(0.2)]) assert.throws(() => createRandomStream(seed));
  const stream = createRandomStream(Array(11).fill(0));
  stream.counter = 0x100000000;
  const before = structuredClone(stream);
  assert.throws(() => nextRandomWord(stream), /耗尽/);
  assert.deepEqual(stream, before);
  assert.throws(() => normalizeGame({ ...createGame(), randomState: { algorithm: 'unknown' } }), /存档损坏/);
});

test('Fisher–Yates preserves every standard and mono card and does not mutate input', () => {
  for (const cards of [deck(), ...['blue', 'red', 'green', 'yellow'].map(monoDeck)]) {
    const before = structuredClone(cards);
    const result = shuffle(cards, createRandomStream(Array(11).fill(0)));
    assert.deepEqual(cards, before);
    assert.notEqual(result, cards);
    assert.equal(new Set(result.map(card => card.id)).size, cards.length);
    assert.deepEqual(result.map(card => card.id).sort(), cards.map(card => card.id).sort());
  }
});

function ready(mode = 'standard', count = 3) {
  const g = createGame();
  g.randomState = createRandomStream(Array(11).fill(7));
  for (let i = 0; i < count; i++) addPlayer(g, `p${i}`, `玩家${i}`, i > 0);
  act(g, 'p0', { type: 'beginVote' });
  act(g, 'p0', { type: 'vote', choices: { ...DEFAULT_OPTIONS, deckMode: mode } });
  return g;
}
test('all production deals use the persisted stream, including independent mono suit assignment', t => {
  t.mock.method(Math, 'random', () => { throw Error('insecure source'); });
  for (const mode of ['standard', 'mono']) {
    const g = ready(mode, mode === 'mono' ? 4 : 3);
    const restored = normalizeGame(JSON.parse(JSON.stringify(g)));
    act(g, 'p0', { type: 'start' });
    act(restored, 'p0', { type: 'start' });
    assert.deepEqual(g.players, restored.players);
    assert.deepEqual(g.randomState, restored.randomState);
    assert.ok(g.randomState.counter > 0);
    const cards = g.players.flatMap(player => player.hand);
    assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
    if (mode === 'mono') assert.equal(new Set(g.players.map(player => player.monoSuit)).size, 4);
  }
});

test('legacy normalization preserves dealt hands and scores while seeding only future shuffles', () => {
  const g = ready();
  act(g, 'p0', { type: 'start' });
  delete g.randomState;
  const players = structuredClone(g.players), round = g.round, phase = g.phase;
  normalizeGame(g);
  assert.deepEqual(g.players, players);
  assert.equal(g.round, round);
  assert.equal(g.phase, phase);
  assert.equal(g.randomState.counter, 0);
});

test('private stream and accidental unknown fields never enter players, spectators, logs, or events', () => {
  const g = ready();
  act(g, 'p0', { type: 'start' });
  Object.assign(g, { seed: 'secret-seed', deck: ['private-deck'], identities: { key: 'private-token' }, futureSecret: 'unknown-secret' });
  g.players[1].token = 'private-player-token';
  g.events.push({ seq: 999, type: 'turn', time: 1, round: 1, phase: 'bid', turn: 1, key: 'event-secret' });
  for (const v of [viewFor(g, 'p0'), viewFor(g, 'p1'), spectatorView(g)]) {
    const raw = JSON.stringify(v);
    for (const secret of ['randomState', 'nonce', 'counter', 'secret-seed', 'private-deck', 'private-token', 'unknown-secret', 'private-player-token', 'event-secret']) assert.ok(!raw.includes(secret), secret);
    assert.equal(v.events.at(-1).key, undefined);
  }
});

test('nested rule options and cached views whitelist rule keys and enum values', async () => {
  const { sanitizeClientView } = await import('../src/room-session.js');
  const g = ready();
  const poison = { randomState: { key: 'nested-key' }, seed: 'nested-seed', key: 'nested-secret', deckMode: 'invalid-deck' };
  Object.assign(g.options, poison);
  g.history.push({ round: 0, cardsPerRound: 0, options: { ...DEFAULT_OPTIONS, ...poison }, result: [] });
  Object.assign(g.vote.pending, { seed: ['vote-secret'] });
  Object.assign(g.vote.resolved, { key: 'vote-key' });
  g.vote.ballots.p0 = { ...DEFAULT_OPTIONS, seed: 'ballot-secret' };
  for (const visible of [viewFor(g, 'p0'), viewFor(g, 'p1'), spectatorView(g), sanitizeClientView(g, 'p0')]) {
    assert.deepEqual(visible.options, DEFAULT_OPTIONS);
    const raw = JSON.stringify(visible);
    for (const secret of ['randomState', 'nested-key', 'nested-seed', 'nested-secret', 'invalid-deck', 'vote-secret', 'vote-key', 'ballot-secret']) assert.ok(!raw.includes(secret), secret);
  }
  const cached = viewFor(g, 'p0');
  Object.assign(cached.options, poison);
  Object.assign(cached.history[0].options, poison);
  const clean = sanitizeClientView(cached, 'p0');
  assert.deepEqual(clean.options, DEFAULT_OPTIONS);
  assert.deepEqual(clean.history[0].options, DEFAULT_OPTIONS);
  assert.ok(!JSON.stringify(clean).includes('nested-'));
});
