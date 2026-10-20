import { act, spectatorView, SUIT_NAMES } from './game.js';

export function appendPublicEvent(game, text) {
  const seq = (game.publicEventSeq || 0) + 1;
  game.publicEventSeq = seq;
  game.publicEvents = [...(game.publicEvents || []), { seq, time: Date.now(), text: text.slice(0, 300) }].slice(-100);
}

function cardName(card) {
  return card?.kind === 'wizard' ? '巫师 W' : card?.kind === 'jester' ? '小丑 J' :
    `${SUIT_NAMES[card?.suit]?.split(' · ')[0] || ''} ${card?.rank ?? ''}`.trim();
}

export function applyPublicAction(game, actor, action) {
  const before = spectatorView(game);
  act(game, actor, action);
  const after = spectatorView(game);
  const member = after.players.find(player => player.id === actor);
  const name = member?.name || '玩家';
  let message = '';
  if (action.type === 'play' || action.type === 'timeout') {
    const play = after.trick.at(-1);
    if (play) message = `${after.players[play.player]?.name} ${action.type === 'timeout' ? '超时自动出牌' : '出牌'}：${cardName(play.card)}`;
  } else if (action.type === 'bid') {
    // A submission is public; its numeric value follows the selected prediction rule.
    message = member?.bid == null ? `${name} 已提交预估` : `${name} 预估 ${member.bid} 墩`;
  } else if (action.type === 'trump') message = `${name} 选择主牌：${SUIT_NAMES[after.trump]?.split(' · ')[0]}`;
  else if (action.type === 'rename') message = `${before.players.find(player => player.id === actor)?.name || '玩家'} 改名为 ${name}`;
  else if (action.type === 'chat') message = `${name} 发送消息：${action.text.trim()}`;
  else if (action.type === 'beginVote') message = `房主发起第 ${after.vote.targetRound} 轮规则投票`;
  else if (action.type === 'vote') message = `${name} 已提交规则投票`;
  else if (action.type === 'cancelVote') message = '房主取消规则投票';
  else if (action.type === 'rematch') message = '房主开启新的一局';
  if (message) appendPublicEvent(game, message);
  if (after.round > before.round) appendPublicEvent(game, `第 ${after.round} 轮开始，每人 ${after.cardsPerRound} 张牌`);
  else if (action.type === 'next') appendPublicEvent(game, after.phase === 'rules' ?
    `房主发起第 ${after.vote.targetRound} 轮规则投票` : `下一墩开始，${after.players[after.turn]?.name} 先出牌`);
  if (after.completedTricks > before.completedTricks && after.lastWinner != null) {
    appendPublicEvent(game, `${after.players[after.lastWinner]?.name} 赢下第 ${after.completedTricks} 墩`);
  }
  if (after.history.length > before.history.length) {
    appendPublicEvent(game, `第 ${after.round} 轮结算：${after.history.at(-1).result.map(result => `${after.players.find(player => player.id === result.id)?.name} ${result.delta >= 0 ? '+' : ''}${result.delta} 分`).join('，')}`);
  }
}
