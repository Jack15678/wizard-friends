import { createGame, normalizeGame, addPlayer, act, botAction, viewFor, spectatorView, SUIT_NAMES, TURN_MS } from '../src/game.js';
import { appendPublicEvent } from '../src/spectator-events.js';

export const NORMAL_RETENTION_MS = 30 * 60 * 1000;
export const PAUSED_RETENTION_MS = 4 * 60 * 60 * 1000;
export const PRACTICE_RETENTION_MS = 10 * 60 * 1000;
export const CONTINUATION_MS = 60000;
export const RESULTS_MS = 60000;
export const RECONNECT_GRACE_MS = 8000;
const playableRound = game => ['trump', 'bid', 'play', 'trickEnd'].includes(game.phase) && game.round > 0;
const clone = value => structuredClone(value);

// A serializable room controller. Its clock is supplied by the DO, so tests can
// exercise four-hour lifetimes without sleeping or changing the process clock.
export class RoomAuthority {
  constructor(record, now = Date.now()) {
    this.record = record || {
      version: 2, game: createGame(), identities: {}, hostId: null,
      lifecycle: { paused: false, pauseReason: '', hostOfflineSince: null, retentionDeadline: null,
        pauseOfflineDeadline: null, continuationVote: null, closeAfterRound: false,
        resultsDeadline: null, resultsConfirmed: [], closed: false },
      reconnectUntil: {}, task: null, frozen: null, savedAt: now,
    };
    normalizeGame(this.record.game);
    this.record.reconnectUntil ||= {};
    this.record.lifecycle.resultsConfirmed ||= [];
  }
  get game() { return this.record.game; }
  get life() { return this.record.lifecycle; }
  get closed() { return this.life.closed; }
  hostOnline() { return this.game.players.find(p => p.id === this.record.hostId)?.online === true; }
  join(hash, { host = false, name = '', automaticName = false, spectator = false } = {}, now = Date.now()) {
    if (this.closed) throw new Error('房间已关闭，旧链接不能重新开启牌局。');
    if (spectator) return { id: `spectator:${hash}`, spectator: true, host: false };
    let id = this.record.identities[hash];
    if (!id) {
      if (!host && !this.record.hostId) throw new Error('等待原房主迁移牌局，请稍后重新连接。');
      id = crypto.randomUUID();
      addPlayer(this.game, id, name, false, automaticName);
      this.record.identities[hash] = id;
    }
    if (host && this.record.hostId && this.record.hostId !== id) throw new Error('房主身份不匹配。');
    if (host) this.record.hostId = id;
    const player = this.game.players.find(p => p.id === id);
    if (!player) throw new Error('该身份已离开座位，不能恢复。');
    player.online = true;
    delete this.record.reconnectUntil[id];
    if (id === this.record.hostId) {
      this.life.hostOfflineSince = null;
      if (!this.life.paused) this.life.retentionDeadline = null;
    }
    this.syncClock(now); this.schedule(now);
    return { id, host: id === this.record.hostId, spectator: false };
  }
  disconnect(id, now = Date.now()) {
    const player = this.game.players.find(p => p.id === id);
    if (!player || !player.online || player.bot || this.closed) return;
    player.online = false;
    this.record.reconnectUntil[id] = now + RECONNECT_GRACE_MS;
    if (id === this.record.hostId) {
      this.life.hostOfflineSince = now;
      if (this.life.paused) {
        this.life.pauseOfflineDeadline ??= now + PAUSED_RETENTION_MS;
        this.life.retentionDeadline = this.life.pauseOfflineDeadline;
      } else this.life.retentionDeadline = now + NORMAL_RETENTION_MS;
    }
    this.syncClock(now); this.schedule(now);
  }
  held(now) {
    const current = this.game.players[this.game.turn];
    return this.life.paused || !!this.life.continuationVote ||
      (this.game.phase === 'play' && current && !current.online && (this.record.reconnectUntil[current.id] || 0) > now);
  }
  syncClock(now) {
    const held = this.held(now);
    if (held && !this.record.frozen) {
      this.record.frozen = {
        remaining: this.game.phase === 'play' && Number.isFinite(this.game.turnDeadline) ? Math.max(0, this.game.turnDeadline - now) : null,
        taskRemaining: this.record.task ? Math.max(0, this.record.task.at - now) : null,
      };
      this.game.turnDeadline = null;
    } else if (!held && this.record.frozen) {
      if (this.game.phase === 'play') this.game.turnDeadline = now + (this.record.frozen.remaining ?? TURN_MS);
      if (this.record.task && this.record.frozen.taskRemaining != null) this.record.task.at = now + this.record.frozen.taskRemaining;
      this.record.frozen = null;
    }
  }
  execute(actor, action, now, system = false) {
    if (!system && ['timeout'].includes(action?.type)) throw new Error('自动出牌仅由房间服务执行。');
    if (this.life.closeAfterRound && ['beginVote', 'start', 'rematch'].includes(action?.type)) throw new Error('续赛仅完成当前轮，结果确认后关闭。');
    if (this.life.closeAfterRound && action?.type === 'next' && this.game.phase !== 'trickEnd') throw new Error('当前轮结束后关闭房间。');
    const before = spectatorView(this.game);
    const frozenDeadline = this.game.turnDeadline;
    const phase = this.game.phase, turn = this.game.turn;
    const host = this.game.players[0], wasOnline = host?.online;
    try {
      if (system && host) host.online = true;
      act(this.game, actor, action, undefined, now);
    } finally { if (system && host) host.online = wasOnline; }
    if (['chat', 'rename'].includes(action.type)) this.game.turnDeadline = frozenDeadline;
    else if (this.game.phase === 'play' && (phase !== 'play' || turn !== this.game.turn)) {
      // The next player receives a full 30 seconds after the card entry animation.
      this.game.turnDeadline = now + TURN_MS + 450;
    }
    this.recordPublicAction(before, actor, action, now);
    if (this.game.phase !== phase || this.game.turn !== turn) this.record.task = null;
    if (['roundEnd', 'finished'].includes(this.game.phase) && this.life.closeAfterRound) {
      this.life.resultsDeadline ??= now + RESULTS_MS;
      this.life.resultsConfirmed ||= [];
    }
    // A seat may have disconnected before it becomes active. Freeze its full
    // newly assigned budget as soon as the previous action hands it the turn.
    this.syncClock(now);
  }
  recordPublicAction(before, actor, action, now) {
    const after = spectatorView(this.game);
    const member = after.players.find(p => p.id === actor), name = member?.name || '玩家';
    const append = text => appendPublicEvent(this.game, text, now);
    const cardLabel = card => card.kind === 'wizard' ? '巫师 W' : card.kind === 'jester' ? '小丑 J' : `${SUIT_NAMES[card.suit]?.split(' · ')[0]} ${card.rank}`;
    if (['play', 'timeout'].includes(action.type)) {
      const play = after.trick.at(-1);
      if (play) append(`${after.players[play.player]?.name} ${action.type === 'timeout' ? '超时自动出牌' : '出牌'}：${cardLabel(play.card)}`);
    } else if (action.type === 'bid') append(member?.bid == null ? `${name} 已提交预估` : `${name} 预估 ${member.bid} 墩`);
    else if (action.type === 'trump') append(`${name} 选择主牌：${SUIT_NAMES[after.trump]?.split(' · ')[0]}`);
    else if (action.type === 'rename') append(`${before.players.find(p => p.id === actor)?.name || '玩家'} 改名为 ${name}`);
    else if (action.type === 'chat') append(`${name} 发送消息：${action.text.trim()}`);
    else if (action.type === 'beginVote') append(`房主发起第 ${after.vote.targetRound} 轮规则投票`);
    else if (action.type === 'vote') append(`${name} 已提交规则投票`);
    else if (action.type === 'cancelVote') append('房主取消规则投票');
    else if (action.type === 'rematch') append('房主开启新的一局');
    if (after.round > before.round) append(`第 ${after.round} 轮开始，每人 ${after.cardsPerRound} 张牌`);
    else if (action.type === 'next') append(after.phase === 'rules' ? `房主发起第 ${after.vote.targetRound} 轮规则投票` : `下一墩开始，${after.players[after.turn]?.name} 先出牌`);
    if (after.completedTricks > (before.completedTricks || 0) && after.lastWinner != null) append(`${after.players[after.lastWinner]?.name} 赢下第 ${after.completedTricks} 墩`);
    if (after.history.length > before.history.length) append(`第 ${after.round} 轮结算：${after.history.at(-1).result.map(result => `${after.players.find(p => p.id === result.id)?.name} ${result.delta >= 0 ? '+' : ''}${result.delta} 分`).join('，')}`);
  }
  handle(identity, message, now = Date.now()) {
    if (this.closed) throw new Error('房间已关闭。');
    const player = this.game.players.find(p => p.id === identity.id);
    if (identity.spectator || !player?.online) throw new Error('观众不能执行玩家操作。');
    const host = identity.id === this.record.hostId;
    const controls = ['pause', 'resume', 'dissolve', 'addbot', 'remove'];
    if (controls.includes(message.type) && !host) throw new Error('只有房主可以执行此操作。');
    if (message.type === 'dissolve') { this.close('房主已解散房间。'); return; }
    if (message.type === 'leave') { this.disconnect(identity.id, now); return; }
    if (message.type === 'continuationVote') {
      const vote = this.life.continuationVote;
      if (!vote || now >= vote.deadline || !vote.voters.includes(identity.id) || typeof message.accept !== 'boolean') throw new Error('当前不能参与续赛投票。');
      if (vote.accepted.includes(identity.id)) throw new Error('你已确认续赛。');
      if (!message.accept) { this.close('续赛投票未获全员同意，房间已关闭。'); return; }
      vote.accepted.push(identity.id);
      if (vote.voters.every(id => vote.accepted.includes(id))) {
        this.life.continuationVote = null; this.life.closeAfterRound = true;
        this.life.paused = false; this.life.pauseReason = '';
        this.syncClock(now);
      }
      this.schedule(now); return;
    }
    if (message.type === 'confirmResults') {
      if (!this.life.resultsDeadline) throw new Error('当前没有待确认的续赛结果。');
      if (!this.life.resultsConfirmed.includes(identity.id)) this.life.resultsConfirmed.push(identity.id);
      const online = this.game.players.filter(p => !p.bot && p.online);
      if (online.every(p => this.life.resultsConfirmed.includes(p.id))) this.close('续赛结果已确认，房间已关闭。');
      return;
    }
    if (message.type === 'pause') {
      if (this.life.closeAfterRound || this.life.continuationVote) throw new Error('续赛投票或收尾期间不能另行暂停。');
      if (!this.life.paused) {
        this.life.paused = true;
        this.life.pauseReason = typeof message.reason === 'string' && message.reason.trim() ? message.reason.trim().slice(0, 100) : '房主主动暂停';
        this.life.pauseOfflineDeadline = null;
        this.syncClock(now);
      }
      return;
    }
    if (message.type === 'resume') {
      if (this.life.continuationVote) throw new Error('已开始续赛投票，房主返回不会取消投票。');
      this.life.paused = false; this.life.pauseReason = ''; this.life.pauseOfflineDeadline = null;
      this.life.retentionDeadline = this.hostOnline() ? null : now + NORMAL_RETENTION_MS;
      this.syncClock(now); this.schedule(now); return;
    }
    const social = message.type === 'action' && ['chat', 'rename'].includes(message.action?.type);
    if (this.life.continuationVote && !social) throw new Error('请先完成续赛投票。');
    if (this.life.paused && !social) throw new Error('房间已暂停，牌局和剩余时间已保留。');
    if (message.type === 'addbot') {
      addPlayer(this.game, crypto.randomUUID(), '', true, true);
      this.game.players.at(-1).botDifficulty = message.difficulty === 'simple' ? 'simple' : 'smart';
    } else if (message.type === 'remove') {
      if (this.game.phase !== 'lobby' || message.id === this.record.hostId) throw new Error('只能在大厅移除其他玩家。');
      const index = this.game.players.findIndex(p => p.id === message.id);
      if (index < 0) throw new Error('没有这个席位。');
      this.game.players.splice(index, 1);
      for (const [hash, id] of Object.entries(this.record.identities)) if (id === message.id) delete this.record.identities[hash];
    } else if (message.type === 'action') this.execute(identity.id, message.action, now);
    else throw new Error('不支持的房间操作。');
    this.schedule(now);
  }
  close(reason) {
    this.life.closed = true; this.life.closeReason = reason;
    this.life.paused = false; this.life.continuationVote = null;
    this.game.turnDeadline = null; this.record.task = null; this.record.frozen = null;
  }
  expire(now) {
    if (this.closed) return;
    const vote = this.life.continuationVote;
    if (vote) {
      if (now >= vote.deadline) this.close('60 秒续赛投票未获全员确认，房间已关闭。');
      return;
    }
    if (this.life.closeAfterRound) {
      if (this.life.resultsDeadline && now >= this.life.resultsDeadline) this.close('续赛结果展示期限已到，房间已关闭。');
      return;
    }
    if (this.hostOnline() || !this.life.retentionDeadline || now < this.life.retentionDeadline) return;
    const voters = this.game.players.filter(p => p.online && !p.bot).map(p => p.id);
    if (!voters.length || !playableRound(this.game)) { this.close('保留期限已到，房间已关闭。'); return; }
    this.life.continuationVote = { deadline: now + CONTINUATION_MS, voters, accepted: [] };
    this.syncClock(now);
  }
  automaticAction(now) {
    if (this.game.phase === 'trickEnd') return { actor: this.record.hostId, action: { type: 'next' } };
    if (['roundEnd', 'finished'].includes(this.game.phase)) return null;
    for (const p of this.game.players) {
      if (!p.bot && !(this.life.closeAfterRound && !p.online)) continue;
      if (!p.online && (this.record.reconnectUntil[p.id] || 0) > now) continue;
      const shadow = clone(this.game);
      const candidate = shadow.players.find(x => x.id === p.id);
      candidate.bot = true; candidate.online = true;
      const action = botAction(shadow, p.id);
      if (action) return { actor: p.id, action, substitute: !p.bot };
    }
    return null;
  }
  schedule(now) {
    if (this.closed || this.held(now)) return;
    const next = this.automaticAction(now);
    if (!next) { this.record.task = null; return; }
    const signature = `${this.game.phase}:${this.game.round}:${this.game.turn}:${this.game.trick.length}:${next.actor}`;
    if (this.record.task?.signature !== signature) this.record.task = { signature, at: now + (this.game.phase === 'trickEnd' ? 1500 : 750) };
  }
  tick(now = Date.now()) {
    this.expire(now);
    if (this.closed) return;
    this.syncClock(now);
    if (this.held(now)) return;
    if (this.game.phase === 'play' && Number.isFinite(this.game.turnDeadline) && now >= this.game.turnDeadline) {
      this.execute(this.record.hostId, { type: 'timeout' }, now, true);
    } else if (this.record.task && now >= this.record.task.at) {
      const next = this.automaticAction(now); this.record.task = null;
      if (next) {
        const p = this.game.players.find(x => x.id === next.actor), online = p?.online;
        try { if (p) p.online = true; this.execute(next.actor, next.action, now, true); }
        finally { if (p) p.online = online; }
      }
    }
    this.schedule(now);
  }
  nextAlarm(now = Date.now()) {
    if (this.closed) return null;
    const values = [];
    if (!this.hostOnline() && !this.life.closeAfterRound && !this.life.continuationVote && this.life.retentionDeadline) values.push(this.life.retentionDeadline);
    if (this.life.continuationVote) values.push(this.life.continuationVote.deadline);
    if (this.life.resultsDeadline) values.push(this.life.resultsDeadline);
    if (this.life.closeAfterRound) for (const until of Object.values(this.record.reconnectUntil)) if (until > now) values.push(until);
    if (!this.held(now)) {
      if (this.game.phase === 'play' && Number.isFinite(this.game.turnDeadline)) values.push(this.game.turnDeadline);
      if (this.record.task) values.push(this.record.task.at);
    } else for (const until of Object.values(this.record.reconnectUntil)) if (until > now) values.push(until);
    return values.length ? Math.max(now + 1, Math.min(...values)) : null;
  }
  view(identity, spectators = 0, now = Date.now()) {
    const result = identity.spectator ? spectatorView(this.game) : viewFor(this.game, identity.id);
    result.spectatorCount = spectators;
    result.lifecycle = {
      paused: this.life.paused, pauseReason: this.life.pauseReason,
      hostOffline: !this.hostOnline(), hostOfflineSince: this.life.hostOfflineSince,
      retentionDeadline: this.life.retentionDeadline,
      retentionMs: this.life.paused ? PAUSED_RETENTION_MS : NORMAL_RETENTION_MS,
      continuationVote: this.life.continuationVote ? clone(this.life.continuationVote) : null,
      closeAfterRound: this.life.closeAfterRound, resultsDeadline: this.life.resultsDeadline,
      resultsConfirmed: [...this.life.resultsConfirmed],
      remainingMs: this.record.frozen?.remaining ?? (Number.isFinite(this.game.turnDeadline) ? Math.max(0, this.game.turnDeadline - now) : null),
      reconnecting: this.held(now) && !this.life.paused && !this.life.continuationVote,
      closed: this.closed,
    };
    if (this.held(now)) { result.legal = []; result.canBid = false; result.bids = []; }
    return result;
  }
}
