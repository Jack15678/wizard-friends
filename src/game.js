export const SUITS = ['blue', 'red', 'green', 'yellow'];
export const SUIT_NAMES = { blue: '蓝 · 冰霜', red: '红 · 烈焰', green: '绿 · 森林', yellow: '黄 · 星辰' };
export function deck() {
  return [
    ...SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ id: `${suit}-${i + 1}`, suit, rank: i + 1, kind: 'number' }))),
    ...['wizard', 'jester'].flatMap(kind => Array.from({ length: 4 }, (_, i) => ({ id: `${kind}-${i}`, kind }))),
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
export function winner(trick, trump) {
  const wizard = trick.find(x => x.card.kind === 'wizard');
  if (wizard) return wizard.player;
  const numbers = trick.filter(x => x.card.kind === 'number');
  if (!numbers.length) return trick[0].player;
  const suit = numbers.some(x => x.card.suit === trump) ? trump : numbers[0].card.suit;
  return numbers.filter(x => x.card.suit === suit).reduce((a, b) => a.card.rank > b.card.rank ? a : b).player;
}
export const points = (bid, won) => bid === won ? 20 + won * 10 : -10 * Math.abs(bid - won);
export function createGame() {
  return { phase: 'lobby', players: [], round: 0, dealer: 0, turn: 0, trump: null, reveal: null, trick: [], history: [], log: [], options: { short: false, strict: false } };
}
export function addPlayer(g, id, name, bot = false) {
  if (g.phase !== 'lobby' || g.players.length >= 6) throw new Error('房间已开始或已满员。');
  if (g.players.some(p => p.id === id)) throw new Error('玩家已在房间。');
  if (typeof name !== 'string' || !name.trim() || name.length > 16) throw new Error('昵称需要 1–16 个字符。');
  g.players.push({ id, name: name.trim(), bot, score: 0, bid: null, won: 0, hand: [], online: true });
}
function deal(g, random) {
  g.round++;
  const cards = shuffled(deck(), random);
  g.players.forEach(p => { p.hand = []; p.bid = null; p.won = 0; });
  for (let i = 0; i < g.round; i++) for (let j = 1; j <= g.players.length; j++) g.players[(g.dealer + j) % g.players.length].hand.push(cards.pop());
  g.reveal = cards.pop() ?? null;
  g.trump = g.reveal?.kind === 'number' ? g.reveal.suit : null;
  g.trick = [];
  g.completedTricks = 0;
  g.lastWinner = null;
  g.phase = g.reveal?.kind === 'wizard' ? 'trump' : 'bid';
  g.turn = g.phase === 'trump' ? g.dealer : (g.dealer + 1) % g.players.length;
  g.log = [`第 ${g.round} 轮开始，每人 ${g.round} 张牌。`];
}
export function allowedBids(g) {
  return Array.from({ length: g.round + 1 }, (_, i) => i).filter(n =>
    !(g.options.strict && g.players.filter(p => p.bid === null).length === 1 && g.players.reduce((s, p) => s + (p.bid ?? 0), 0) + n === g.round));
}
export function act(g, actor, action, random = Math.random) {
  if (!action || typeof action !== 'object') throw new Error('无效操作。');
  const host = g.players[0]?.id;
  if (action.type === 'start') {
    if (actor !== host || g.phase !== 'lobby' || g.players.length < 3 || g.players.some(p => !p.online)) throw new Error('需要 3–6 位在线玩家，由房主开始。');
    g.options = { short: !!action.short, strict: !!action.strict };
    g.maxRounds = g.options.short ? 5 : Math.floor(60 / g.players.length);
    deal(g, random);
    return;
  }
  if (action.type === 'next') {
    if (actor !== host || !['trickEnd', 'roundEnd'].includes(g.phase)) throw new Error('等待房主继续。');
    if (g.phase === 'roundEnd') { g.dealer = (g.dealer + 1) % g.players.length; deal(g, random); }
    else { g.trick = []; g.turn = g.lastWinner; g.phase = 'play'; }
    return;
  }
  const p = g.players[g.turn];
  if (!p || p.id !== actor) throw new Error('还没有轮到你。');
  if (action.type === 'trump' && g.phase === 'trump') {
    if (!SUITS.includes(action.suit)) throw new Error('请选择一种王牌花色。');
    g.trump = action.suit;
    g.phase = 'bid';
    g.turn = (g.dealer + 1) % g.players.length;
    return;
  }
  if (action.type === 'bid' && g.phase === 'bid') {
    if (!allowedBids(g).includes(action.value)) throw new Error('这个预言数不符合当前规则。');
    p.bid = action.value;
    g.log.push(`${p.name} 预言 ${p.bid} 墩。`);
    g.turn = (g.turn + 1) % g.players.length;
    if (g.players.every(x => x.bid !== null)) { g.phase = 'play'; g.turn = (g.dealer + 1) % g.players.length; }
    return;
  }
  if (action.type === 'play' && g.phase === 'play') {
    const card = legalCards(p.hand, g.trick).find(c => c.id === action.card);
    if (!card) throw new Error('这张牌不能出：有首攻花色时必须跟色，巫师和小丑除外。');
    p.hand.splice(p.hand.findIndex(c => c.id === card.id), 1);
    g.trick.push({ player: g.turn, card });
    g.turn = (g.turn + 1) % g.players.length;
    if (g.trick.length === g.players.length) {
      g.lastWinner = winner(g.trick, g.trump);
      g.players[g.lastWinner].won++;
      g.completedTricks++;
      g.phase = 'trickEnd';
      g.log.push(`${g.players[g.lastWinner].name} 赢得第 ${g.completedTricks} 墩。`);
      if (g.completedTricks === g.round) {
        const result = g.players.map(x => {
          const delta = points(x.bid, x.won); x.score += delta;
          return { id: x.id, bid: x.bid, won: x.won, delta, total: x.score };
        });
        g.history.push({ round: g.round, result });
        g.phase = g.round === g.maxRounds ? 'finished' : 'roundEnd';
      }
    }
    return;
  }
  throw new Error('当前阶段不能执行这个操作。');
}
export function viewFor(g, id) {
  return {
    ...g,
    players: g.players.map(p => {
      const { hand, ...publicPlayer } = p;
      return { ...publicPlayer, count: hand.length, ...(p.id === id ? { hand } : {}) };
    }),
    legal: g.phase === 'play' && g.players[g.turn]?.id === id ? legalCards(g.players[g.turn].hand, g.trick).map(c => c.id) : [],
    bids: g.phase === 'bid' ? allowedBids(g) : [],
  };
}
export function botAction(g) {
  const p = g.players[g.turn];
  if (!p?.bot) return null;
  if (g.phase === 'trump') {
    return { type: 'trump', suit: SUITS.reduce((a, b) => p.hand.filter(c => c.suit === a).length >= p.hand.filter(c => c.suit === b).length ? a : b) };
  }
  if (g.phase === 'bid') {
    const target = Math.min(g.round, Math.round(p.hand.reduce((n, c) => n + (c.kind === 'wizard' ? 1 : c.kind === 'jester' ? 0 : c.suit === g.trump ? (c.rank + 3) / 16 : Math.max(0, c.rank - 9) / 8), 0)));
    return { type: 'bid', value: allowedBids(g).reduce((a, b) => Math.abs(a - target) <= Math.abs(b - target) ? a : b) };
  }
  if (g.phase === 'play') {
    const strength = c => c.kind === 'wizard' ? 100 : c.kind === 'jester' ? -1 : c.rank + (c.suit === g.trump ? 20 : 0);
    const cards = [...legalCards(p.hand, g.trick)].sort((a, b) => strength(a) - strength(b));
    const needs = p.won < p.bid;
    const wins = cards.filter(card => winner([...g.trick, { player: g.turn, card }], g.trump) === g.turn);
    const loses = cards.filter(card => !wins.includes(card));
    return { type: 'play', card: (needs ? (wins[0] ?? cards[0]) : (loses.at(-1) ?? cards[0])).id };
  }
  return null;
}
