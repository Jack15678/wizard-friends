import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomAuthority, NORMAL_RETENTION_MS, PAUSED_RETENTION_MS, CONTINUATION_MS, RESULTS_MS, RECONNECT_GRACE_MS } from '../worker/room-authority.js';
import { DEFAULT_OPTIONS } from '../src/rules-vote.js';

function setup() {
  let now = 100000;
  const room = new RoomAuthority(undefined, now);
  const host = room.join('host-hash', { host: true, name: '房主' }, now);
  const a = room.join('a-hash', { name: '甲' }, now);
  const b = room.join('b-hash', { name: '乙' }, now);
  const send = (who, message) => room.handle(who, message, now);
  const advance = ms => { now += ms; room.tick(now); };
  const start = () => {
    send(host, { type: 'action', action: { type: 'beginVote' } });
    for (const who of [host, a, b]) send(who, { type: 'action', action: { type: 'vote', choices: { ...DEFAULT_OPTIONS, short: true } } });
    send(host, { type: 'action', action: { type: 'start' } });
    if (room.game.phase === 'trump') send([host, a, b].find(i => i.id === room.game.players[room.game.turn].id), { type: 'action', action: { type: 'trump', suit: 'blue' } });
    while (room.game.phase === 'bid') send([host, a, b].find(i => i.id === room.game.players[room.game.turn].id), { type: 'action', action: { type: 'bid', value: 0 } });
  };
  return { room, host, a, b, send, advance, start, now: () => now };
}

test('ordinary host retention is 30m from last effective disconnect; other activity cannot renew it', () => {
  const s = setup();
  s.room.disconnect(s.host.id, s.now());
  const deadline = s.now() + NORMAL_RETENTION_MS;
  assert.equal(s.room.life.retentionDeadline, deadline);
  s.advance(10000); s.send(s.a, { type: 'action', action: { type: 'chat', text: '在线' } });
  assert.equal(s.room.life.retentionDeadline, deadline);
  s.room.join('host-hash', { host: true }, s.now());
  assert.equal(s.room.life.retentionDeadline, null);
  s.advance(NORMAL_RETENTION_MS * 3);
  assert.equal(s.room.closed, false, 'online host never expires through inactivity');
  s.room.disconnect(s.host.id, s.now()); s.advance(NORMAL_RETENTION_MS);
  assert.equal(s.room.closed, true, 'lobby closes directly at deadline');
});

test('same active pause fixes its first-offline 4h deadline; refresh cannot extend it; formal resume starts a new pause', () => {
  const s = setup(); s.send(s.host, { type: 'pause', reason: '休息' });
  s.room.disconnect(s.host.id, s.now());
  const deadline = s.now() + PAUSED_RETENTION_MS;
  s.advance(1000); s.room.join('host-hash', { host: true }, s.now());
  s.advance(1000); s.room.disconnect(s.host.id, s.now());
  assert.equal(s.room.life.retentionDeadline, deadline);
  s.room.join('host-hash', { host: true }, s.now()); s.send(s.host, { type: 'resume' });
  s.send(s.host, { type: 'pause' }); s.room.disconnect(s.host.id, s.now());
  assert.equal(s.room.life.retentionDeadline, s.now() + PAUSED_RETENTION_MS);
  s.advance(PAUSED_RETENTION_MS);
  assert.equal(s.room.closed, true);
});

test('pause freezes time, AI and selections while chat and room inspection remain available', () => {
  const s = setup(); s.start();
  s.advance(4000);
  const remaining = s.room.game.turnDeadline - s.now();
  const hand = structuredClone(s.room.game.players.map(p => p.hand));
  s.send(s.host, { type: 'pause' });
  s.send(s.a, { type: 'action', action: { type: 'chat', text: '稍等' } });
  s.advance(PAUSED_RETENTION_MS * 2);
  assert.deepEqual(s.room.game.players.map(p => p.hand), hand);
  assert.equal(s.room.game.turnDeadline, null);
  assert.equal(s.room.view(s.a, 0, s.now()).lifecycle.remainingMs, remaining);
  assert.throws(() => s.send(s.a, { type: 'action', action: { type: 'play', card: hand[1][0].id } }), /暂停/);
  assert.throws(() => s.send(s.a, { type: 'resume' }), /房主/);
  s.send(s.host, { type: 'resume' });
  assert.equal(s.room.game.turnDeadline, s.now() + remaining);
});

test('current player disconnect freezes remaining budget for reconnect grace without treating it as room pause', () => {
  const s = setup(); s.start(); s.advance(5000);
  const current = [s.host, s.a, s.b].find(p => p.id === s.room.game.players[s.room.game.turn].id);
  const remaining = s.room.game.turnDeadline - s.now();
  s.room.disconnect(current.id, s.now());
  assert.equal(s.room.life.paused, false); assert.equal(s.room.game.turnDeadline, null);
  s.advance(2000);
  s.room.join(current.id === s.host.id ? 'host-hash' : current.id === s.a.id ? 'a-hash' : 'b-hash', { host: current.id === s.host.id }, s.now());
  assert.equal(s.room.game.turnDeadline, s.now() + remaining);
  s.room.disconnect(current.id, s.now()); s.advance(RECONNECT_GRACE_MS);
  assert.equal(s.room.game.turnDeadline, s.now() + remaining);
  assert.equal(s.room.game.trick.length, 0);
});

test('expiry snapshots online humans only and a returning owner cannot cancel the 60s vote', () => {
  const s = setup(); s.start();
  s.room.disconnect(s.host.id, s.now());
  s.advance(NORMAL_RETENTION_MS);
  const vote = s.room.life.continuationVote;
  assert.deepEqual(vote.voters, [s.a.id, s.b.id]);
  assert.equal(vote.deadline, s.now() + CONTINUATION_MS);
  s.room.join('host-hash', { host: true }, s.now());
  assert.ok(s.room.life.continuationVote);
  assert.throws(() => s.send(s.host, { type: 'resume' }), /不会取消/);
  assert.throws(() => s.send(s.host, { type: 'continuationVote', accept: true }), /不能参与/);
  s.send(s.a, { type: 'continuationVote', accept: true });
  s.send(s.b, { type: 'continuationVote', accept: false });
  assert.equal(s.room.closed, true);
});

test('vote nonresponse and missing online humans close without reviving a room', () => {
  const s = setup(); s.start(); s.room.disconnect(s.host.id, s.now());
  s.advance(NORMAL_RETENTION_MS); s.send(s.a, { type: 'continuationVote', accept: true });
  s.advance(CONTINUATION_MS);
  assert.equal(s.room.closed, true);
  assert.throws(() => s.room.join('host-hash', { host: true }, s.now()), /已关闭/);
  const noHumans = setup(); noHumans.start();
  for (const who of [noHumans.host, noHumans.a, noHumans.b]) noHumans.room.disconnect(who.id, noHumans.now());
  noHumans.advance(NORMAL_RETENTION_MS);
  assert.equal(noHumans.room.closed, true);
});

test('unanimous continuation substitutes offline seats, scores once, forbids another round and has bounded result wait', () => {
  const s = setup(); s.start(); s.send(s.host, { type: 'pause' });
  s.room.disconnect(s.host.id, s.now()); s.advance(PAUSED_RETENTION_MS);
  s.send(s.a, { type: 'continuationVote', accept: true }); s.send(s.b, { type: 'continuationVote', accept: true });
  assert.equal(s.room.life.closeAfterRound, true); assert.equal(s.room.life.paused, false);
  assert.throws(() => s.send(s.a, { type: 'action', action: { type: 'rematch' } }), /续赛/);
  let budget = 30;
  while (!s.room.life.resultsDeadline && budget-- > 0) {
    if (s.room.game.phase === 'play') {
      const current = [s.a, s.b].find(i => i.id === s.room.game.players[s.room.game.turn].id);
      if (current) {
        const card = s.room.view(current, 0, s.now()).legal[0];
        s.send(current, { type: 'action', action: { type: 'play', card } });
      }
    }
    s.advance(1600);
  }
  assert.equal(s.room.game.history.length, 1);
  assert.ok(s.room.life.resultsDeadline <= s.now() + RESULTS_MS);
  assert.ok(s.room.life.resultsDeadline >= s.now() + RESULTS_MS - 1600);
  const round = s.room.game.round;
  s.room.join('host-hash', { host: true }, s.now());
  assert.equal(s.room.life.closeAfterRound, true);
  assert.throws(() => s.send(s.host, { type: 'action', action: { type: 'next' } }), /结束后关闭/);
  s.advance(RESULTS_MS);
  assert.equal(s.room.closed, true); assert.equal(s.room.game.round, round); assert.equal(s.room.game.history.length, 1);
});

test('persisted authority resumes exact hands, timer remainder, ballots and fixed pause deadline', () => {
  const s = setup(); s.start(); s.send(s.host, { type: 'pause' }); s.room.disconnect(s.host.id, s.now());
  const save = structuredClone(s.room.record);
  const resumed = new RoomAuthority(save, s.now() + 1000);
  resumed.join('host-hash', { host: true }, s.now() + 1000);
  assert.deepEqual(resumed.game.players.map(p => p.hand), s.room.game.players.map(p => p.hand));
  assert.equal(resumed.life.retentionDeadline, s.room.life.retentionDeadline);
  assert.equal(resumed.view(s.a).lifecycle.remainingMs, s.room.view(s.a).lifecycle.remainingMs);
  assert.equal(Object.hasOwn(resumed.view(s.host), 'randomState'), false);
  assert.equal(JSON.stringify(resumed.view(s.a)).includes('host-hash'), false);
});

test('paused AI task resumes its exact remaining delay instead of playing during pause or restarting the delay', () => {
  const s = setup(); s.start();
  s.room.game.players[s.room.game.turn].bot = true;
  s.room.schedule(s.now());
  s.advance(250); s.send(s.host, { type: 'pause' });
  assert.equal(s.room.record.frozen.taskRemaining, 500);
  s.advance(PAUSED_RETENTION_MS * 2);
  assert.equal(s.room.game.trick.length, 0);
  s.send(s.host, { type: 'resume' });
  s.advance(499); assert.equal(s.room.game.trick.length, 0);
  s.advance(1); assert.equal(s.room.game.trick.length, 1);
});

test('pending per-round vote survives persistence with its private ballots and public progress intact', () => {
  const s = setup(); s.send(s.host, { type: 'action', action: { type: 'beginVote' } });
  s.send(s.a, { type: 'action', action: { type: 'vote', choices: DEFAULT_OPTIONS } });
  const resumed = new RoomAuthority(structuredClone(s.room.record), s.now());
  assert.deepEqual(resumed.game.vote.ballots[s.a.id], DEFAULT_OPTIONS);
  assert.deepEqual(resumed.view(s.host).vote.submitted, [s.a.id]);
  assert.equal(resumed.view(s.host).vote.ownChoices, null);
  assert.deepEqual(resumed.view(s.a).vote.ownChoices, DEFAULT_OPTIONS);
  assert.equal(JSON.stringify(resumed.view({ id: 'observer', spectator: true })).includes('ballots'), false);
});

test('every online human result confirmation closes a completed continuation before the upper deadline', () => {
  const s = setup(); s.start(); s.send(s.host, { type: 'pause' });
  s.room.disconnect(s.host.id, s.now()); s.advance(PAUSED_RETENTION_MS);
  s.send(s.a, { type: 'continuationVote', accept: true }); s.send(s.b, { type: 'continuationVote', accept: true });
  while (!s.room.life.resultsDeadline) {
    const current = [s.a, s.b].find(i => i.id === s.room.game.players[s.room.game.turn].id);
    if (s.room.game.phase === 'play' && current) s.send(current, { type: 'action', action: { type: 'play', card: s.room.view(current).legal[0] } });
    s.advance(1600);
  }
  s.send(s.a, { type: 'confirmResults' }); assert.equal(s.room.closed, false);
  s.send(s.b, { type: 'confirmResults' }); assert.equal(s.room.closed, true);
});

test('a previously disconnected next seat receives its full new turn budget after reconnect', () => {
  const s = setup(); s.start();
  s.room.game.turn = 0;
  s.room.game.turnDeadline = s.now() + 30000;
  s.room.disconnect(s.a.id, s.now());
  s.advance(2000);
  const card = s.room.view(s.host, 0, s.now()).legal[0];
  s.send(s.host, { type: 'action', action: { type: 'play', card } });
  assert.equal(s.room.game.turn, 1);
  assert.equal(s.room.game.turnDeadline, null);
  assert.equal(s.room.record.frozen.remaining, 30450);
  s.advance(4000);
  s.room.join('a-hash', {}, s.now());
  assert.equal(s.room.game.turnDeadline - s.now(), 30450);
});

test('a system bot handoff also freezes a previously disconnected next seat budget', () => {
  const s = setup(); s.start();
  s.room.game.turn = 0; s.room.game.turnDeadline = s.now() + 30000;
  s.room.game.players[0].bot = true;
  s.room.schedule(s.now());
  s.room.disconnect(s.a.id, s.now());
  s.advance(1000);
  assert.equal(s.room.game.turn, 1);
  assert.equal(s.room.game.turnDeadline, null);
  assert.equal(s.room.record.frozen.remaining, 30450);
  s.advance(3000); s.room.join('a-hash', {}, s.now());
  assert.equal(s.room.game.turnDeadline - s.now(), 30450);
});
