export const DEFAULT_OPTIONS = {
  short: false, strict: false, deckMode: 'standard', predictionMode: 'public', foresight: false,
};
export const RULE_CHOICES = {
  deckMode: ['standard', 'mono'],
  predictionMode: ['public', 'hidden', 'secret'],
  strict: [false, true],
  foresight: [false, true],
  short: [false, true],
};
export function normalizeOptions(options = {}) {
  const result = { ...DEFAULT_OPTIONS, ...options };
  if (result.predictionMode !== 'public') result.strict = false;
  return result;
}
export function beginVote(players, options) {
  const pending = Object.fromEntries(Object.entries(RULE_CHOICES).map(([key, values]) => [key, [...values]]));
  if (players.length > 4) pending.deckMode = ['standard'];
  const resolved = {};
  if (options) {
    for (const key of ['deckMode', 'short']) {
      resolved[key] = options[key];
      delete pending[key];
    }
  }
  return { round: 1, pending, resolved, ballots: {} };
}
export function submitVote(vote, players, actor, choices) {
  const voters = players.filter(p => !p.bot);
  if (!voters.some(p => p.id === actor && p.online)) throw new Error('只有在线真人玩家可以投票。');
  if (players.some(p => !p.online)) throw new Error('等待所有玩家重新连接后继续投票。');
  if (!Object.keys(vote.pending).length) throw new Error('规则已经选定，等待房主发牌。');
  if (Object.hasOwn(vote.ballots, actor)) throw new Error('你已提交本次投票。');
  const keys = Object.keys(vote.pending);
  if (!choices || typeof choices !== 'object' || Array.isArray(choices) ||
      Object.keys(choices).length !== keys.length ||
      keys.some(key => !Object.hasOwn(choices, key) || !vote.pending[key].includes(choices[key]))) {
    throw new Error('请为每个待选规则提交有效选项。');
  }
  vote.ballots[actor] = Object.fromEntries(keys.map(key => [key, choices[key]]));
  if (!voters.every(p => Object.hasOwn(vote.ballots, p.id))) return;
  const tied = {};
  for (const [key, values] of Object.entries(vote.pending)) {
    const counts = values.map(value => voters.filter(p => vote.ballots[p.id][key] === value).length);
    const winners = values.filter((_, index) => counts[index] === Math.max(...counts));
    if (winners.length === 1) vote.resolved[key] = winners[0];
    else tied[key] = winners;
  }
  if (vote.resolved.predictionMode && vote.resolved.predictionMode !== 'public') {
    vote.resolved.strict = false;
    delete tied.strict;
  }
  vote.pending = tied;
  // Expose tally results, then discard private ballots before a tied item is voted on again.
  vote.ballots = {};
  if (Object.keys(tied).length) vote.round++;
}
export function voteView(vote, id) {
  if (!vote) return null;
  return {
    round: vote.round, targetRound: vote.targetRound, pending: vote.pending, resolved: vote.resolved,
    submitted: Object.keys(vote.ballots), ownChoices: vote.ballots[id] ?? null,
    complete: Object.keys(vote.pending).length === 0,
  };
}
