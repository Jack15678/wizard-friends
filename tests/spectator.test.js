import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, spectatorView, viewFor, botAction } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-vote.js';

function game(options = {}) {
  const g = createGame();
  for (const id of ['host', 'guest', 'third']) addPlayer(g, id, id);
  g.options = { ...DEFAULT_OPTIONS, ...options };
  g.phase = 'bid'; g.round = 1; g.cardsPerRound = 2;
  g.players.forEach((player, i) => {
    player.hand = [{ id: `red-${i + 1}`, kind: 'number', suit: 'red', rank: i + 1 }, { id: 'wizard-0', kind: 'wizard' }];
    player.bid = i === 0 ? 1 : null;
  });
  return g;
}

test('spectator sees public progress and chat, without hands, legal actions or private identity data', () => {
  const g = game();
  g.phase = 'play'; g.players[1].score = 30; g.players[1].won = 1;
  g.reveal = { id: 'blue-12', kind: 'number', suit: 'blue', rank: 12 };
  g.trump = 'blue'; g.turnDeadline = Date.now() + 30000;
  g.trick = [{ player: 1, card: { id: 'green-3', kind: 'number', suit: 'green', rank: 3 } }];
  g.chat = [{ seq: 1, player: 'guest', name: 'guest', text: '好牌！', time: 12, token: 'CHAT_PRIVATE' }];
  g.log = ['第 1 轮开始，每人 2 张牌。', 'host 预言 1 墩。'];
  g.identities = { TOKEN_PRIVATE: 'host' }; g.token = 'ROOT_PRIVATE'; g.players[0].token = 'PLAYER_PRIVATE';
  g.options.credentials = 'RULE_PRIVATE'; g.reveal.token = 'CARD_PRIVATE';
  const before = structuredClone(g), view = spectatorView(g), raw = JSON.stringify(view);
  assert.deepEqual(g, before);
  assert.equal(view.spectator, true); assert.equal(view.canBid, false);
  assert.deepEqual(view.legal, []); assert.deepEqual(view.bids, []);
  assert.ok(view.players.every(player => !Object.hasOwn(player, 'hand')));
  assert.deepEqual(view.players.map(player => player.count), [2, 2, 2]);
  assert.equal(view.players[0].bid, 1); assert.equal(view.players[1].score, 30);
  assert.equal(view.players[1].won, 1); assert.deepEqual(view.trick, before.trick);
  assert.deepEqual(view.reveal, before.reveal && { id: 'blue-12', kind: 'number', suit: 'blue', rank: 12 });
  assert.equal(view.turnDeadline, g.turnDeadline);
  assert.equal(view.chat[0].text, '好牌！'); assert.deepEqual(view.log, g.log);
  assert.ok(!raw.includes('PRIVATE')); assert.ok(!raw.includes('wizard-0')); assert.ok(!raw.includes('red-1'));
  assert.deepEqual(spectatorView(view), view, 'saving an already public view retains its public counts and fields');
});

for (const mode of ['hidden', 'secret']) test(`${mode} spectator cannot recover unannounced bids from players, history or logs`, () => {
  const g = game({ predictionMode: mode });
  g.log = ['host 已提交预估。', 'host 预言 1 墩。'];
  g.history = [{ round: 1, cardsPerRound: 2, result: [{ id: 'host', bid: 1, won: 0, delta: -10, total: -10 }] }];
  const view = spectatorView(g);
  assert.equal(view.players[0].bid, null); assert.equal(view.players[0].bidSubmitted, true);
  assert.equal(view.players[1].bidSubmitted, false);
  assert.deepEqual(view.log, ['host 已提交预估。']); assert.deepEqual(view.history, []);
  g.phase = 'play';
  assert.equal(spectatorView(g).players[0].bid, mode === 'hidden' ? 1 : null);
  g.phase = 'roundEnd';
  assert.equal(spectatorView(g).players[0].bid, 1);
  assert.deepEqual(spectatorView(g).history, g.history);
});

test('first-round foresight never exposes any player hand to spectators', () => {
  const g = game({ foresight: true, predictionMode: 'secret' });
  for (const phase of ['trump', 'bid', 'play']) {
    g.phase = phase;
    const view = spectatorView(g);
    assert.equal(view.foresightActive, false);
    assert.ok(view.players.every(player => !Object.hasOwn(player, 'hand')));
    assert.deepEqual(view.players.map(player => player.count), [2, 2, 2]);
  }
});

test('spectator voting progress excludes private ballots and choices, even on a second sanitization', () => {
  const g = createGame();
  for (const id of ['host', 'guest', 'third']) addPlayer(g, id, id);
  act(g, 'host', { type: 'beginVote' });
  act(g, 'host', { type: 'vote', choices: { ...DEFAULT_OPTIONS, predictionMode: 'secret' } });
  g.vote.token = 'VOTE_PRIVATE';
  const view = spectatorView(g);
  assert.equal(view.phase, 'rules'); assert.deepEqual(view.vote.submitted, ['host']);
  assert.equal(view.vote.targetRound, 1);
  assert.equal(view.vote.ballots, undefined); assert.equal(view.vote.ownChoices, null);
  assert.deepEqual(view.vote.resolved, {});
  assert.ok(!JSON.stringify(view).includes('VOTE_PRIVATE'));
  assert.deepEqual(spectatorView(view), view);
});

for (const deckMode of ['standard', 'mono']) for (const predictionMode of ['hidden', 'secret']) {
  test(`${deckMode} later-round spectator keeps settled history and vote progress but sees no foresight hands or locked ${predictionMode} bids`, () => {
    const g = createGame();
    for (const id of ['host', 'guest', 'third']) addPlayer(g, id, id);
    act(g, 'host', { type: 'beginVote' });
    for (const p of g.players) act(g, p.id, { type: 'vote', choices: { ...DEFAULT_OPTIONS, deckMode, predictionMode: 'secret' } });
    act(g, 'host', { type: 'start' }, () => .5);
    let steps = 0;
    while (g.phase !== 'roundEnd' && steps++ < 1000) {
      if (g.phase === 'trickEnd') act(g, 'host', { type: 'next' });
      else {
        const player = g.players.find(p => viewFor(g, p.id).canBid) ?? g.players[g.turn];
        player.bot = true;
        const action = botAction(g, player.id);
        player.bot = false;
        act(g, player.id, action);
      }
    }
    assert.equal(g.phase, 'roundEnd');
    const settled = spectatorView(g);
    act(g, 'host', { type: 'next' });
    let visible = spectatorView(g);
    assert.deepEqual(visible.history, settled.history);
    assert.deepEqual(visible.players.map(p => p.bid), settled.players.map(p => p.bid));
    assert.equal(visible.history[0].options.predictionMode, 'secret');
    assert.equal(visible.vote.targetRound, 2);
    assert.deepEqual(visible.vote.resolved, { deckMode, short: false });
    const choices = { predictionMode, strict: true, foresight: true };
    act(g, 'guest', { type: 'vote', choices });
    visible = spectatorView(g);
    assert.deepEqual(visible.vote.submitted, ['guest']);
    assert.equal(visible.vote.ownChoices, null);
    assert.equal(visible.vote.ballots, undefined);
    for (const p of g.players.filter(p => p.id !== 'guest')) act(g, p.id, { type: 'vote', choices });
    assert.deepEqual(spectatorView(spectatorView(g)), spectatorView(g));
    act(g, 'host', { type: 'start' }, () => .5);
    if (g.phase === 'trump') act(g, g.players[g.dealer].id, { type: 'trump', suit: 'blue' });
    assert.equal(viewFor(g, 'guest').foresightActive, true);
    assert.ok(viewFor(g, 'guest').players.filter(p => p.id !== 'guest').every(p => p.hand.length === g.cardsPerRound));
    const assertSpectatorHidden = () => {
      const view = spectatorView(g);
      assert.equal(view.foresightActive, false);
      assert.ok(view.players.every(p => !('hand' in p)));
      for (const card of g.players.flatMap(p => p.hand)) assert.ok(!JSON.stringify(view).includes(`"id":"${card.id}"`));
      assert.deepEqual(spectatorView(view), view);
      return view;
    };
    assertSpectatorHidden();
    act(g, 'host', { type: 'bid', value: 2 });
    visible = assertSpectatorHidden();
    assert.equal(visible.players[0].bid, null);
    assert.equal(visible.players[0].bidSubmitted, true);
    assert.ok(!visible.log.some(line => line.includes('预言 2 墩')));
    assert.deepEqual(visible.history, settled.history);
    for (const p of g.players.filter(p => p.bid === null)) act(g, p.id, { type: 'bid', value: 0 });
    assert.equal(spectatorView(g).players[0].bid, predictionMode === 'secret' ? null : 2);
  });
}

test('spectator history preserves each round rules while discarding private option fields', () => {
  const g = game();
  g.history = [{ round: 0, cardsPerRound: 1, options: { ...DEFAULT_OPTIONS, predictionMode: 'hidden', token: 'HISTORY_PRIVATE' }, result: [] }];
  const visible = spectatorView(g);
  assert.deepEqual(visible.history[0].options, { ...DEFAULT_OPTIONS, predictionMode: 'hidden' });
  assert.ok(!JSON.stringify(visible).includes('HISTORY_PRIVATE'));
  assert.deepEqual(spectatorView(visible), visible);
});

test('spectator receives only bounded public event fields and a bounded spectator count', () => {
  const g = game();
  g.publicEvents = Array.from({ length: 105 }, (_, seq) => ({ seq, time: seq + 1, text: `公开事件 ${seq}`, token: 'EVENT_PRIVATE' }));
  g.publicEvents.push({ seq: 106, time: 1, text: '坏'.repeat(301) }, { seq: 'bad', time: 1, text: '无效' });
  g.publicEventSeq = 104; g.spectatorCount = 100;
  const view = spectatorView(g);
  assert.equal(view.publicEvents.length, 100); assert.equal(view.publicEvents[0].seq, 5);
  assert.deepEqual(view.publicEvents.at(-1), { seq: 104, time: 105, text: '公开事件 104' });
  assert.equal(view.publicEventSeq, 104); assert.equal(view.spectatorCount, 50);
  assert.ok(!JSON.stringify(view).includes('EVENT_PRIVATE'));
});
