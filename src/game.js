import { resolveName, validateName } from './player-names.js';
import { DEFAULT_OPTIONS, RULE_CHOICES, normalizeOptions, beginVote, submitVote, voteView } from './rules-vote.js';

export const SUITS = ['blue', 'red', 'green', 'yellow'];
export const SUIT_NAMES = { blue: '蓝 · 冰霜', red: '红 · 烈焰', green: '绿 · 森林', yellow: '黄 · 星辰' };
export function deck() {
  return [
    ...SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ id: `${suit}-${i + 1}`, suit, rank: i + 1, kind: 'number' }))),
    ...['wizard', 'jester'].flatMap(kind => Array.from({ length: 4 }, (_, i) => ({ id: `${kind}-${i}`, kind }))),
  ];
}
export function monoDeck(suit) {
  return [
    ...Array.from({ length: 13 }, (_, i) => ({ id: `${suit}-${i + 1}`, suit, rank: i + 1, kind: 'number' })),
    ...['wizard', 'jester'].map(kind => ({ id: `${kind}-${suit}`, kind })),
  ];
}
export function shuffled(cards, random = Math.random) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function leadSuit(trick) {
  const first = trick.find(x => x.card.kind !== 'jester');
  return first?.card.kind === 'number' ? first.card.suit : null;
}
export function legalCards(hand, trick) {
  const suit = leadSuit(trick);
  if (!suit || !hand.some(c => c.suit === suit)) return hand;
  return hand.filter(c => c.kind !== 'number' || c.suit === suit);
}
export function winner(trick, trump, deckMode = 'standard') {
  const wizard = trick.find(x => x.card.kind === 'wizard');
  if (wizard) return wizard.player;
  const numbers = trick.filter(x => x.card.kind === 'number');
  if (!numbers.length) return trick[0].player;
  const suit = numbers.some(x => x.card.suit === trump) ? trump : numbers[0].card.suit;
  const candidates = deckMode === 'mono' ? numbers : numbers.filter(x => x.card.suit === suit);
  return candidates.reduce((a, b) => a.card.rank >= b.card.rank ? a : b).player;
}
export const points = (bid, won) => bid === won ? 20 + won * 10 : -10 * Math.abs(bid - won);
export function createGame() {
  return {
    phase: 'lobby', players: [], round: 0, cardsPerRound: 0, dealer: 0, turn: 0,
    trump: null, reveal: null, trick: [], history: [], log: [], options: { ...DEFAULT_OPTIONS },
  };
}
export function normalizeGame(g) {
  g.options = normalizeOptions(g.options);
  g.cardsPerRound ??= g.round + (g.options.deckMode === 'mono' && g.round ? 3 : 0);
  return g;
}
export function addPlayer(g, id, name, bot = false, automatic = false) {
  if (g.phase !== 'lobby' || g.players.length >= 6) throw new Error('房间已开始或已满员。');
  if (g.players.some(p => p.id === id)) throw new Error('玩家已在房间。');
  if (!automatic) validateName(name);
  const resolved = resolveName(name, g.players.map(p => p.name), { automatic });
  g.players.push({ id, name: resolved, automaticName: automatic, bot, score: 0, bid: null, won: 0, hand: [], online: true });
}
function deal(g, random) {
  g.round++;
  g.cardsPerRound = g.round + (g.options.deckMode === 'mono' ? 3 : 0);
  g.players.forEach(p => { p.hand = []; p.bid = null; p.won = 0; });
  if (g.options.deckMode === 'mono') {
    g.players.forEach(p => { p.hand = shuffled(monoDeck(p.monoSuit), random).slice(0, g.cardsPerRound); });
    g.reveal = null;
  } else {
    const cards = shuffled(deck(), random);
    for (let i = 0; i < g.cardsPerRound; i++) {
      for (let j = 1; j <= g.players.length; j++) g.players[(g.dealer + j) % g.players.length].hand.push(cards.pop());
    }
    g.reveal = cards.pop() ?? null;
  }
  g.trump = g.reveal?.kind === 'number' ? g.reveal.suit : null;
  g.trick = [];
  g.completedTricks = 0;
  g.lastWinner = null;
  g.phase = g.reveal?.kind === 'wizard' ? 'trump' : 'bid';
  g.turn = g.phase === 'trump' ? g.dealer : (g.dealer + 1) % g.players.length;
  g.log = [`第 ${g.round} 轮开始，每人 ${g.cardsPerRound} 张牌。`];
}
export function allowedBids(g) {
  const size = g.cardsPerRound ?? g.round;
  return Array.from({ length: size + 1 }, (_, i) => i).filter(n =>
    !(g.options.strict && (g.options.predictionMode ?? 'public') === 'public' &&
      g.players.filter(p => p.bid === null).length === 1 &&
      g.players.reduce((s, p) => s + (p.bid ?? 0), 0) + n === size));
}
function canBid(g, id) {
  const p = g.players.find(x => x.id === id);
  return g.phase === 'bid' && !!p?.online && p.bid === null &&
    ((g.options.predictionMode ?? 'public') !== 'public' || g.players[g.turn]?.id === id);
}
function foresightActive(g) {
  return !!g.options.foresight && g.round === 1 && ['trump', 'bid'].includes(g.phase);
}
export const TURN_MS = 30000;
export function act(g, actor, action, random = Math.random) {
  const phase = g.phase, turn = g.turn;
  if (action?.type === 'play' && phase === 'play' && Number.isFinite(g.turnDeadline) && Date.now() >= g.turnDeadline) throw new Error('出牌时间已到，正在自动出牌。');
  applyAction(g, actor, action, random);
  if (g.phase === 'play') {
    if (phase !== 'play' || turn !== g.turn || !Number.isFinite(g.turnDeadline)) g.turnDeadline = Date.now() + TURN_MS;
  } else if (g.turnDeadline != null) g.turnDeadline = null;
}
function applyAction(g, actor, action, random, timedOut = false) {
  if (!action || typeof action !== 'object') throw new Error('无效操作。');
  if (action.type === 'chat' || action.type === 'rename') {
    const member = g.players.find(p => p.id === actor && p.online && !p.bot);
    if (!member) throw new Error('只有已入座的在线玩家可以操作。');
    if (action.type === 'rename') {
      validateName(action.name);
      member.name = resolveName(action.name, g.players.filter(p => p.id !== actor).map(p => p.name));
      member.automaticName = false;
    } else {
      if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 300) throw new Error('消息需要 1–300 个字符。');
      const now = Date.now();
      const recent = (g.chat || []).filter(m => m.player === actor && now - m.time < 5000);
      if (recent.length >= 5) throw new Error('消息发送太快，请稍等几秒。');
      g.chatSeq = (g.chatSeq || 0) + 1;
      g.chat = [...(g.chat || []), { seq: g.chatSeq, player: actor, name: member.name, text: action.text.trim(), time: now }].slice(-100);
    }
    return;
  }
  const host = g.players[0];
  if (['beginVote', 'cancelVote', 'start', 'rematch', 'next', 'timeout'].includes(action.type) &&
      (actor !== host?.id || !host.online)) throw new Error('等待房主操作。');
  if (action.type === 'timeout') {
    if (g.phase !== 'play' || !Number.isFinite(g.turnDeadline) || Date.now() < g.turnDeadline) throw new Error('尚未到出牌超时时间。');
    const player = g.players[g.turn];
    const cards = legalCards(player.hand, g.trick).slice().sort((a, b) =>
      (a.kind === 'wizard' ? 100 : a.kind === 'jester' ? 0 : a.rank) -
      (b.kind === 'wizard' ? 100 : b.kind === 'jester' ? 0 : b.rank));
    // Only an authorized timeout may play for a disconnected seat.
    applyAction(g, player.id, { type: 'play', card: cards[0].id }, random, true);
    g.log.push(`${player.name} 超时，已自动出牌。`);
    return;
  }
  if (action.type === 'beginVote') {
    if (g.phase !== 'lobby' || g.players.length < 3 || g.players.length > 6 ||
        g.players.some(p => !p.online) || !g.players.some(p => !p.bot)) {
      throw new Error('需要 3–6 位在线玩家，由房主发起规则投票。');
    }
    g.vote = beginVote(g.players);
    g.phase = 'rules';
    return;
  }
  if (action.type === 'vote' && g.phase === 'rules') {
    submitVote(g.vote, g.players, actor, action.choices);
    if (!Object.keys(g.vote.pending).length) g.options = normalizeOptions(g.vote.resolved);
    return;
  }
  if (action.type === 'cancelVote') {
    if (g.phase !== 'rules') throw new Error('当前没有规则投票。');
    delete g.vote;
    g.phase = 'lobby';
    return;
  }
  if (action.type === 'start') {
    if (g.phase !== 'rules' || !g.vote || Object.keys(g.vote.pending).length ||
        g.players.some(p => !p.online)) throw new Error('等待全员在线并完成规则投票。');
    g.options = normalizeOptions(g.vote.resolved);
    g.maxRounds = g.options.short ? 5 : g.options.deckMode === 'mono' ? 12 : Math.floor(60 / g.players.length);
    if (g.options.deckMode === 'mono') {
      const suits = shuffled(SUITS, random);
      g.players.forEach((p, index) => { p.monoSuit = suits[index]; });
    }
    delete g.vote;
    deal(g, random);
    return;
  }
  if (action.type === 'rematch') {
    if (g.phase !== 'finished') throw new Error('本局结束后才能再来一局。');
    const players = g.players.map(({ monoSuit, ...p }) => ({ ...p, score: 0, bid: null, won: 0, hand: [] }));
    const { chat, chatSeq } = g;
    for (const key of Object.keys(g)) delete g[key];
    Object.assign(g, createGame(), { players }, chat ? { chat, chatSeq } : {});
    return;
  }
  if (action.type === 'next') {
    if (!['trickEnd', 'roundEnd'].includes(g.phase)) throw new Error('等待房主继续。');
    if (g.phase === 'roundEnd') { g.dealer = (g.dealer + 1) % g.players.length; deal(g, random); }
    else { g.trick = []; g.turn = g.lastWinner; g.phase = 'play'; }
    return;
  }
  if (action.type === 'bid' && g.phase === 'bid') {
    if (!canBid(g, actor)) throw new Error('还没有轮到你预估，或你已提交。');
    if (!allowedBids(g).includes(action.value)) throw new Error('这个预言数不符合当前规则。');
    const p = g.players.find(x => x.id === actor);
    p.bid = action.value;
    const mode = g.options.predictionMode ?? 'public';
    g.log.push(mode === 'public' ? `${p.name} 预言 ${p.bid} 墩。` : `${p.name} 已提交预估。`);
    if (mode === 'public') g.turn = (g.turn + 1) % g.players.length;
    if (g.players.every(x => x.bid !== null)) {
      g.phase = 'play';
      g.turn = (g.dealer + 1) % g.players.length;
      if (mode === 'hidden') g.log.push(...g.players.map(x => `${x.name} 预言 ${x.bid} 墩。`));
    }
    return;
  }
  const p = g.players[g.turn];
  if (!p || p.id !== actor || (!p.online && !timedOut)) throw new Error('还没有轮到你。');
  if (action.type === 'trump' && g.phase === 'trump') {
    if (!SUITS.includes(action.suit)) throw new Error('请选择一种王牌花色。');
    g.trump = action.suit;
    g.phase = 'bid';
    g.turn = (g.dealer + 1) % g.players.length;
    return;
  }
  if (action.type === 'play' && g.phase === 'play') {
    const card = legalCards(p.hand, g.trick).find(c => c.id === action.card);
    if (!card) throw new Error('这张牌不能出：有首攻花色时必须跟色，巫师和小丑除外。');
    p.hand.splice(p.hand.findIndex(c => c.id === card.id), 1);
    g.trick.push({ player: g.turn, card });
    g.turn = (g.turn + 1) % g.players.length;
    if (g.trick.length === g.players.length) {
      g.lastWinner = winner(g.trick, g.trump, g.options.deckMode);
      g.players[g.lastWinner].won++;
      g.completedTricks++;
      g.phase = 'trickEnd';
      g.log.push(`${g.players[g.lastWinner].name} 赢得第 ${g.completedTricks} 墩。`);
      if (g.completedTricks === (g.cardsPerRound ?? g.round)) {
        const result = g.players.map(x => {
          const delta = points(x.bid, x.won); x.score += delta;
          return { id: x.id, bid: x.bid, won: x.won, delta, total: x.score };
        });
        g.history.push({ round: g.round, cardsPerRound: g.cardsPerRound ?? g.round, result });
        g.phase = g.round === g.maxRounds ? 'finished' : 'roundEnd';
        if (g.options.predictionMode === 'secret') g.log.push(...g.players.map(x => `${x.name} 预言 ${x.bid} 墩。`));
      }
    }
    return;
  }
  throw new Error('当前阶段不能执行这个操作。');
}
export function viewFor(g, id) {
  const { vote, players, ...publicGame } = g;
  const foresight = foresightActive(g);
  const seated = players.some(p => p.id === id);
  const mode = g.options.predictionMode ?? 'public';
  const hiddenBids = mode === 'secret' ? !['roundEnd', 'finished'].includes(g.phase) : mode === 'hidden' && ['trump', 'bid'].includes(g.phase);
  const canPredict = canBid(g, id);
  return {
    ...publicGame,
    vote: voteView(vote, id),
    foresightActive: foresight,
    cardsPerRound: g.cardsPerRound ?? g.round,
    players: players.map(p => {
      const { hand, bid, ...publicPlayer } = p;
      const showHand = seated && (foresight ? p.id !== id : p.id === id);
      return { ...publicPlayer, bid: hiddenBids && p.id !== id ? null : bid, bidSubmitted: bid !== null, count: hand.length, ...(showHand ? { hand } : {}) };
    }),
    legal: g.phase === 'play' && players[g.turn]?.id === id ? legalCards(players[g.turn].hand, g.trick).map(c => c.id) : [],
    canBid: canPredict,
    bids: canPredict ? allowedBids(g) : [],
  };
}
export function spectatorView(g) {
  const options = normalizeOptions(Object.fromEntries(Object.entries(RULE_CHOICES)
    .filter(([key, values]) => values.includes(g.options?.[key])).map(([key]) => [key, g.options[key]])));
  const players = g.players.map(player => ({ ...player, hand: Array.isArray(player.hand) ? player.hand : [] }));
  const sourceVote = g.vote;
  const vote = sourceVote ? {
    round: sourceVote.round,
    pending: Object.fromEntries(Object.entries(RULE_CHOICES).filter(([key]) => Array.isArray(sourceVote.pending?.[key]))
      .map(([key, values]) => [key, sourceVote.pending[key].filter(value => values.includes(value))])),
    resolved: Object.fromEntries(Object.entries(RULE_CHOICES).filter(([key, values]) => values.includes(sourceVote.resolved?.[key]))
      .map(([key]) => [key, sourceVote.resolved[key]])),
    ballots: {},
  } : null;
  // A Symbol cannot match a player seat, even if a caller supplies an existing spectator ID.
  const visible = viewFor({ ...g, options, players, vote }, Symbol('spectator'));
  const hiddenBids = options.predictionMode === 'secret' ? !['roundEnd', 'finished'].includes(g.phase) :
    options.predictionMode === 'hidden' && ['trump', 'bid'].includes(g.phase);
  const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const card = value => {
    if (!value || !['number', 'wizard', 'jester'].includes(value.kind)) return null;
    if (value.kind === 'number') return SUITS.includes(value.suit) && Number.isInteger(value.rank) && value.rank >= 1 && value.rank <= 13 ?
      { id: `${value.suit}-${value.rank}`, kind: 'number', suit: value.suit, rank: value.rank } : null;
    const suffix = typeof value.id === 'string' && /^(wizard|jester)-(?:[0-3]|blue|red|green|yellow)$/.test(value.id) ? value.id.split('-')[1] : '0';
    return { id: `${value.kind}-${suffix}`, kind: value.kind };
  };
  // Select public fields explicitly: the host's complete game can contain identity tokens or future private data.
  return {
    phase: visible.phase, round: number(visible.round), cardsPerRound: number(visible.cardsPerRound),
    dealer: number(visible.dealer), turn: number(visible.turn),
    trump: SUITS.includes(visible.trump) ? visible.trump : null, reveal: card(visible.reveal),
    options, maxRounds: number(visible.maxRounds), completedTricks: number(visible.completedTricks),
    lastWinner: Number.isInteger(visible.lastWinner) ? visible.lastWinner : null,
    turnDeadline: Number.isFinite(visible.turnDeadline) ? visible.turnDeadline : null,
    players: visible.players.map((player, index) => ({
      id: typeof player.id === 'string' ? player.id : '', name: typeof player.name === 'string' ? player.name : '', automaticName: player.automaticName === true,
      bot: player.bot === true, online: player.online === true, score: number(player.score), won: number(player.won),
      bid: hiddenBids || !Number.isInteger(player.bid) ? null : player.bid,
      bidSubmitted: g.players[index].bidSubmitted === true || g.players[index].bid != null,
      count: Array.isArray(g.players[index].hand) ? g.players[index].hand.length : Math.max(0, number(g.players[index].count)),
      ...(SUITS.includes(player.monoSuit) ? { monoSuit: player.monoSuit } : {}),
    })),
    trick: (visible.trick || []).flatMap(play => {
      const publicCard = card(play.card);
      return publicCard && Number.isInteger(play.player) && play.player >= 0 && play.player < players.length ? [{ player: play.player, card: publicCard }] : [];
    }),
    history: (visible.history || []).filter(entry => !hiddenBids || entry.round < visible.round).map(entry => ({
      round: number(entry.round), cardsPerRound: number(entry.cardsPerRound, number(entry.round)),
      result: (entry.result || []).filter(result => players.some(player => player.id === result.id)).map(result => ({
        id: result.id, bid: number(result.bid), won: number(result.won), delta: number(result.delta), total: number(result.total),
      })),
    })),
    // Old or accidentally unsanitized snapshots must not reveal a locked prediction through the journal.
    log: (visible.log || []).filter(line => typeof line === 'string' && (!hiddenBids || !/预[言估]\s*\d+\s*墩/.test(line))),
    chat: (visible.chat || []).filter(message => typeof message.text === 'string').map(message => ({
      seq: number(message.seq), player: typeof message.player === 'string' ? message.player : '',
      name: typeof message.name === 'string' ? message.name : '', text: message.text, time: number(message.time),
    })),
    chatSeq: number(visible.chatSeq),
    publicEvents: (visible.publicEvents || []).filter(event => Number.isFinite(event.seq) && Number.isFinite(event.time) &&
      typeof event.text === 'string' && event.text.length <= 300).slice(-100).map(({ seq, time, text }) => ({ seq, time, text })),
    publicEventSeq: number(visible.publicEventSeq),
    spectatorCount: Math.max(0, Math.min(50, Math.floor(number(visible.spectatorCount)))),
    vote: vote ? {
      round: number(vote.round), pending: vote.pending, resolved: vote.resolved,
      submitted: (Array.isArray(sourceVote.submitted) ? sourceVote.submitted : Object.keys(sourceVote.ballots || {}))
        .filter(id => players.some(player => player.id === id)),
      ownChoices: null, complete: Object.keys(vote.pending).length === 0,
    } : null,
    spectator: true, foresightActive: false, canBid: false, legal: [], bids: [],
  };
}
export function botAction(g, actorId = g.players[g.turn]?.id) {
  const v = viewFor(g, actorId);
  const index = v.players.findIndex(x => x.id === actorId);
  const p = v.players[index];
  if (!p?.bot || !p.online) return null;
  const hand = p.hand ?? [];
  if (v.phase === 'trump' && v.turn === index) {
    return { type: 'trump', suit: SUITS.reduce((a, b) => hand.filter(c => c.suit === a).length >= hand.filter(c => c.suit === b).length ? a : b) };
  }
  if (v.canBid) {
    const estimate = v.foresightActive ? v.cardsPerRound / v.players.length : hand.reduce((n, c) =>
      n + (c.kind === 'wizard' ? 1 : c.kind === 'jester' ? 0 : v.options.deckMode === 'mono' ? c.rank / 26 : c.suit === v.trump ? (c.rank + 3) / 16 : Math.max(0, c.rank - 9) / 8), 0);
    const target = Math.min(v.cardsPerRound, Math.round(estimate));
    return { type: 'bid', value: v.bids.reduce((a, b) => Math.abs(a - target) <= Math.abs(b - target) ? a : b) };
  }
  if (v.phase === 'play' && v.turn === index) {
    const strength = c => c.kind === 'wizard' ? 100 : c.kind === 'jester' ? -1 : c.rank + (c.suit === v.trump ? 20 : 0);
    const cards = hand.filter(c => v.legal.includes(c.id)).sort((a, b) => strength(a) - strength(b));
    if (!cards.length) return null;
    const needs = p.won < p.bid;
    const wins = cards.filter(card => winner([...v.trick, { player: index, card }], v.trump, v.options.deckMode) === index);
    const loses = cards.filter(card => !wins.includes(card));
    return { type: 'play', card: (needs ? (wins[0] ?? cards[0]) : (loses.at(-1) ?? cards[0])).id };
  }
  return null;
}
