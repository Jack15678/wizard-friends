import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, viewFor, botAction, normalizeGame, spectatorView } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-vote.js';
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
function votingSession(count = 3) {
  const saved = hostSession();
  saved.game.players.forEach(p => { p.hand = []; });
  for (let i = 2; i < count; i++) addPlayer(saved.game, `bot${i}`, `机器人${i}`, true);
  act(saved.game, 'host', { type: 'beginVote' });
  return saved;
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

test('rules snapshots preserve real voting progress and only the guest own choices', () => {
  const host = votingSession(), hostTab = storage(), guestTab = storage();
  const choices = { ...DEFAULT_OPTIONS, deckMode: 'mono', predictionMode: 'secret', foresight: true };
  act(host.game, 'guest', { type: 'vote', choices });
  const guestView = viewFor(host.game, 'guest');
  assert.equal(saveRoomSession(hostTab, host), true);
  assert.equal(saveRoomSession(guestTab, { role: 'guest', room: host.room, me: 'guest', state: guestView }), true);
  const guest = readRoomSession(guestTab);
  assert.equal(guest.state.phase, 'rules');
  assert.deepEqual(guest.state.vote, guestView.vote);
  assert.deepEqual(guest.state.vote.submitted, ['guest']);
  assert.deepEqual(guest.state.vote.ownChoices, choices);
  assert.equal(guest.state.vote.ballots, undefined);
  const restored = readRoomSession(hostTab).game;
  assert.deepEqual(restored.vote.ballots.guest, choices);
  act(restored, 'host', { type: 'vote', choices });
  act(restored, 'host', { type: 'start' });
  assert.equal(restored.options.deckMode, 'mono');
  assert.equal(restored.cardsPerRound, 4);
});

for (const deckMode of ['standard', 'mono']) test(`${deckMode} guest snapshot retains permitted first-round foresight cards and restores normal privacy after bidding`, () => {
  const saved = votingSession(deckMode === 'standard' ? 4 : 3), tab = storage();
  const g = saved.game;
  const choices = { ...DEFAULT_OPTIONS, deckMode, predictionMode: 'secret', foresight: true };
  for (const id of ['host', 'guest']) act(g, id, { type: 'vote', choices });
  act(g, 'host', { type: 'start' }, () => 0.999);
  assert.equal(g.phase, deckMode === 'standard' ? 'trump' : 'bid');
  const saveGuest = () => {
    const state = viewFor(g, 'guest');
    assert.equal(saveRoomSession(tab, { role: 'guest', room: saved.room, me: 'guest', state }), true);
    const restored = readRoomSession(tab);
    assert.deepEqual(restored.state, state);
    return restored.state;
  };
  const before = saveGuest();
  assert.equal(before.players.find(p => p.id === 'guest').hand, undefined);
  assert.ok(before.players.filter(p => p.id !== 'guest').every(p => p.hand.length === g.cardsPerRound));
  for (const card of g.players[1].hand) assert.ok(!tab.getItem(ROOM_SESSION_KEY).includes(`"id":"${card.id}"`));
  if (g.phase === 'trump') {
    act(g, 'host', { type: 'trump', suit: 'red' });
    assert.equal(saveGuest().foresightActive, true);
  }
  act(g, 'host', { type: 'bid', value: 1 });
  const bidding = saveGuest();
  assert.equal(bidding.players[0].bid, null);
  assert.equal(bidding.players[0].bidSubmitted, true);
  assert.equal(bidding.players[1].hand, undefined);
  for (const p of g.players.filter(p => p.bid === null)) act(g, p.id, { type: 'bid', value: 0 });
  const after = saveGuest();
  assert.equal(after.phase, 'play');
  assert.equal(after.foresightActive, false);
  assert.deepEqual(after.players.find(p => p.id === 'guest').hand, g.players[1].hand);
  assert.ok(after.players.filter(p => p.id !== 'guest').every(p => !('hand' in p)));
  assert.equal(after.players[0].bid, null);
  assert.equal(after.turnDeadline, g.turnDeadline);
});

test('accidental full-state guest snapshots redact private votes and secret bid values', () => {
  const saved = votingSession(), tab = storage();
  const g = saved.game;
  const choices = { ...DEFAULT_OPTIONS, predictionMode: 'secret' };
  const persistFullState = () => {
    assert.equal(saveRoomSession(tab, { role: 'guest', room: saved.room, me: 'guest', state: g }), true);
    return readRoomSession(tab).state;
  };
  act(g, 'host', { type: 'vote', choices });
  const voting = persistFullState();
  assert.deepEqual(voting.vote.submitted, ['host']);
  assert.equal(voting.vote.ownChoices, null);
  assert.equal(voting.vote.ballots, undefined);
  act(g, 'guest', { type: 'vote', choices });
  act(g, 'host', { type: 'start' }, () => 0.999);
  act(g, 'host', { type: 'bid', value: 1 });
  const bidding = persistFullState();
  assert.equal(bidding.players[0].bid, null);
  assert.equal(bidding.players[0].hand, undefined);
  assert.ok(!JSON.stringify(bidding).includes('预言 1 墩'));
});

test('later-round host and guest refresh preserves voting progress, scores and permitted foresight visibility', () => {
  const saved = votingSession(), hostTab = storage(), guestTab = storage(), spectatorTab = storage();
  const g = saved.game;
  const initial = { ...DEFAULT_OPTIONS, deckMode: 'mono', short: true };
  for (const id of ['host', 'guest']) act(g, id, { type: 'vote', choices: initial });
  act(g, 'host', { type: 'start' });
  let steps = 0;
  while (g.phase !== 'roundEnd' && steps++ < 1000) {
    if (g.phase === 'trickEnd') act(g, 'host', { type: 'next' });
    else {
      const p = g.players.find(player => viewFor(g, player.id).canBid) ?? g.players[g.turn];
      const wasBot = p.bot;
      p.bot = true;
      const action = botAction(g, p.id);
      p.bot = wasBot;
      act(g, p.id, action);
    }
  }
  assert.equal(g.phase, 'roundEnd');
  const history = structuredClone(g.history);
  const scores = g.players.map(p => p.score);
  const suits = g.players.map(p => p.monoSuit);
  act(g, 'host', { type: 'next' });
  const choices = { predictionMode: 'secret', strict: true, foresight: true };
  act(g, 'guest', { type: 'vote', choices });
  assert.equal(saveRoomSession(hostTab, saved), true);
  assert.equal(saveRoomSession(guestTab, { role: 'guest', room: saved.room, me: 'guest', state: viewFor(g, 'guest') }), true);
  const guest = readRoomSession(guestTab).state;
  assert.equal(guest.vote.targetRound, 2);
  assert.deepEqual(guest.vote.pending, { predictionMode: ['public', 'hidden', 'secret'], strict: [false, true], foresight: [false, true] });
  assert.deepEqual(guest.vote.resolved, { deckMode: 'mono', short: true });
  assert.deepEqual(guest.vote.ownChoices, choices);
  assert.equal(guest.vote.ballots, undefined);
  assert.deepEqual(guest.history, history);
  assert.equal(saveRoomSession(spectatorTab, { role: 'spectator', room: saved.room, me: 'viewer', state: g }), true);
  const publicVote = readRoomSession(spectatorTab).state;
  assert.equal(publicVote.vote.targetRound, 2);
  assert.deepEqual(publicVote.vote.submitted, ['guest']);
  assert.equal(publicVote.vote.ownChoices, null);
  assert.deepEqual(publicVote.history, history);
  const restored = normalizeGame(readRoomSession(hostTab).game);
  assert.equal(restored.dealer, 0);
  assert.equal(restored.round, 1);
  assert.deepEqual(restored.players.map(p => p.score), scores);
  act(restored, 'host', { type: 'vote', choices });
  act(restored, 'host', { type: 'start' });
  assert.equal(restored.round, 2);
  assert.equal(restored.dealer, 1);
  assert.deepEqual(restored.players.map(p => p.monoSuit), suits);
  act(restored, 'host', { type: 'bid', value: 2 });
  const view = viewFor(restored, 'guest');
  assert.equal(saveRoomSession(guestTab, { role: 'guest', room: saved.room, me: 'guest', state: view }), true);
  const reloaded = readRoomSession(guestTab).state;
  assert.deepEqual(reloaded, view);
  assert.equal(reloaded.foresightActive, true);
  assert.equal(reloaded.players[1].hand, undefined);
  assert.equal(reloaded.players[0].bid, null);
  assert.ok(reloaded.players.filter(p => p.id !== 'guest').every(p => p.hand.length === 5));
  for (const c of restored.players[1].hand) assert.ok(!guestTab.getItem(ROOM_SESSION_KEY).includes(`"id":"${c.id}"`));
  assert.equal(saveRoomSession(spectatorTab, { role: 'spectator', room: saved.room, me: 'viewer', state: view }), true);
  const publicRound = readRoomSession(spectatorTab).state;
  assert.equal(publicRound.round, 2);
  assert.equal(publicRound.foresightActive, false);
  assert.deepEqual(publicRound.players.map(p => p.count), [5, 5, 5]);
  assert.equal(publicRound.players[0].bid, null);
  assert.ok(publicRound.players.every(p => !('hand' in p)));
  for (const c of restored.players.flatMap(p => p.hand)) assert.ok(!spectatorTab.getItem(ROOM_SESSION_KEY).includes(`"id":"${c.id}"`));
});

test('normalizing an older pending vote supplies target round without losing a submitted ballot', () => {
  const saved = votingSession();
  act(saved.game, 'guest', { type: 'vote', choices: DEFAULT_OPTIONS });
  delete saved.game.vote.targetRound;
  const ballot = structuredClone(saved.game.vote.ballots);
  normalizeGame(saved.game);
  assert.equal(saved.game.vote.targetRound, 1);
  assert.deepEqual(saved.game.vote.ballots, ballot);
});

test('reading an old guest view does not infer new foresight rules or hide an already visible hand', () => {
  const saved = hostSession(), tab = storage();
  Object.assign(saved.game, { phase: 'bid', round: 2, cardsPerRound: 2, options: { ...DEFAULT_OPTIONS, foresight: false } });
  const oldView = viewFor(saved.game, 'guest');
  delete oldView.rulesVersion;
  oldView.options.foresight = true;
  oldView.foresightActive = false;
  tab.setItem(ROOM_SESSION_KEY, JSON.stringify({ version: 1, role: 'guest', room: saved.room, me: 'guest', state: oldView }));
  const reloaded = readRoomSession(tab).state;
  assert.deepEqual(reloaded, oldView);
  assert.deepEqual(reloaded.players[1].hand, saved.game.players[1].hand);
  assert.equal(reloaded.foresightActive, false);
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

test('spectators recover a room without occupying a player seat, before and after receiving public state', () => {
  const tab = storage(), saved = hostSession();
  const spectator = { version: 1, role: 'spectator', room: saved.room, me: 'viewer-uuid' };
  assert.equal(saveRoomSession(tab, spectator), true);
  assert.deepEqual(readRoomSession(tab), spectator);
  assert.equal(saveRoomSession(tab, { ...spectator, state: spectatorView(saved.game) }), true);
  const restored = readRoomSession(tab);
  assert.equal(restored.role, 'spectator'); assert.equal(restored.me, 'viewer-uuid');
  assert.equal(restored.state.players.some(player => player.id === restored.me), false);
  assert.deepEqual(restored.state.players.map(player => player.count), [1, 1]);
  assert.ok(restored.state.players.every(player => !('hand' in player)));
  assert.equal(readRoomSession(tab, 'WXYZ6789'), null);
  clearRoomSession(tab); assert.equal(readRoomSession(tab), null);
});

test('spectator persistence strips accidental full games, private ballots, identity tokens and hidden predictions', () => {
  const tab = storage(), saved = votingSession();
  act(saved.game, 'host', { type: 'vote', choices: { ...DEFAULT_OPTIONS, predictionMode: 'secret' } });
  const viewer = { ...saved, role: 'spectator', me: 'viewer-uuid', state: saved.game };
  assert.equal(saveRoomSession(tab, viewer), true);
  let restored = readRoomSession(tab);
  assert.equal(restored.game, undefined); assert.equal(restored.identities, undefined);
  assert.equal(restored.state.vote.ballots, undefined); assert.equal(restored.state.vote.ownChoices, null);
  assert.deepEqual(restored.state.vote.submitted, ['host']);
  saved.game.phase = 'bid'; saved.game.round = 1; saved.game.options.predictionMode = 'secret';
  saved.game.options.foresight = true; saved.game.players[0].bid = 7;
  saved.game.players[0].hand = [{ id: 'red-7', suit: 'red', rank: 7, kind: 'number' }];
  saved.game.log = ['房主 已提交预估。', '房主 预言 7 墩。'];
  delete saved.game.vote;
  assert.equal(saveRoomSession(tab, { ...saved, role: 'spectator', me: 'viewer-uuid' }), true);
  restored = readRoomSession(tab);
  const raw = tab.getItem(ROOM_SESSION_KEY);
  assert.equal(restored.state.players[0].bid, null);
  assert.equal(restored.state.players[0].bidSubmitted, true);
  assert.ok(!raw.includes('red-7')); assert.ok(!raw.includes('secretHostToken'));
  assert.ok(!raw.includes('预言 7 墩')); assert.ok(!('game' in restored));
  assert.deepEqual(restored.state.players.map(player => player.count), [1, 0, 0]);
});

test('spectator reload sanitizes tampered cached state and rejects unsupported versions', () => {
  const tab = storage(), saved = hostSession();
  tab.setItem(ROOM_SESSION_KEY, JSON.stringify({ ...saved, version: 1, role: 'spectator', me: 'viewer-uuid', state: saved.game }));
  const restored = readRoomSession(tab);
  assert.equal(restored.game, undefined); assert.equal(restored.identities, undefined);
  assert.ok(restored.state.players.every(player => !('hand' in player)));
  tab.setItem(ROOM_SESSION_KEY, JSON.stringify({ version: 2, role: 'spectator', room: saved.room, me: 'viewer-uuid' }));
  assert.equal(readRoomSession(tab), null);
});

test('spectator public state stays recoverable through every room phase including lobby, rules and finished', () => {
  const saved = hostSession(), tab = storage();
  for (const phase of ['lobby', 'rules', 'trump', 'bid', 'play', 'trickEnd', 'roundEnd', 'finished']) {
    saved.game.phase = phase;
    assert.equal(saveRoomSession(tab, { role: 'spectator', room: saved.room, me: 'viewer-uuid', state: spectatorView(saved.game) }), true);
    assert.equal(readRoomSession(tab).state.phase, phase);
  }
});

test('server-authoritative hosts cache only their permitted view, lifecycle, and filtered voting progress', () => {
  const saved = votingSession(), tab = storage();
  act(saved.game,'guest',{type:'vote',choices:DEFAULT_OPTIONS});
  const state=viewFor(saved.game,'host');
  state.lifecycle={paused:true,pauseReason:'休息',remainingMs:12000,retentionDeadline:123456,continuationVote:null,privateKey:'never-cache'};
  state.privateSeed='never-cache';
  assert.equal(saveRoomSession(tab,{...saved,authoritative:true,state}),true);
  const restored=readRoomSession(tab);
  assert.equal(restored.game,undefined);assert.equal(restored.identities,undefined);
  assert.equal(restored.state.lifecycle.paused,true);
  assert.equal(restored.state.lifecycle.remainingMs,12000);
  assert.equal(restored.state.lifecycle.privateKey,undefined);
  assert.deepEqual(restored.state.vote.submitted,['guest']);
  assert.equal(restored.state.players[1].hand,undefined);
  assert.ok(!tab.getItem(ROOM_SESSION_KEY).includes('never-cache'));
  assert.ok(!tab.getItem(ROOM_SESSION_KEY).includes('secretHostToken'));
});

test('legacy filtered guest cache whitelist strips injected random fields on save and read',()=>{
 const source=hostSession(),tab=storage(),state=viewFor(source.game,'guest');
 state.randomState={key:['never-cache']};state.seed='never-cache';state.futurePrivate='never-cache';
 assert.equal(saveRoomSession(tab,{role:'guest',room:source.room,me:'guest',state}),true);
 let restored=readRoomSession(tab);assert.equal(restored.state.seed,undefined);assert.equal(restored.state.randomState,undefined);
 assert.deepEqual(restored.state.players[1].hand,source.game.players[1].hand);
 assert.ok(!tab.getItem(ROOM_SESSION_KEY).includes('never-cache'));
 tab.setItem(ROOM_SESSION_KEY,JSON.stringify({version:1,role:'guest',room:source.room,me:'guest',state,seed:'never-cache'}));
 restored=readRoomSession(tab);assert.equal(restored.seed,undefined);assert.equal(restored.state.randomState,undefined);assert.equal(restored.state.futurePrivate,undefined);
 assert.ok(!tab.getItem(ROOM_SESSION_KEY).includes('never-cache'));
});
