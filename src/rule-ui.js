export const RULE_LABELS = {
  deckMode: { title: '牌库', values: { standard: '标准牌库', mono: '单色牌库' }, hint: '整局固定。单色限 3–4 人，每人独立牌库，首轮 4 张，此后递增。' },
  predictionMode: { title: '预估方式', values: { public: '公开预估', hidden: '隐藏预估', secret: '秘密数字' }, hint: '公开：依次报数。隐藏：全部提交后公开。秘密：本轮结束才公开。' },
  strict: { title: '加减预估', values: { false: '关闭', true: '开启' }, hint: '仅在公开预估获选时生效；最后一人须避开总和等于本轮墩数。' },
  foresight: { title: '先见之明', values: { false: '关闭', true: '开启' }, hint: '当轮生效：看别人的整手牌，不看自己的牌；全部预估完再揭开。' },
  short: { title: '局长', values: { false: '完整局', true: '快速局 · 5 轮' }, hint: '整局固定。标准完整局 10–20 轮，单色完整局 12 轮。' },
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function ruleSummary(options) {
  return [RULE_LABELS.deckMode.values[options.deckMode], RULE_LABELS.predictionMode.values[options.predictionMode],
    ...(options.strict ? ['加减预估'] : []), ...(options.foresight ? ['先见之明'] : []), RULE_LABELS.short.values[options.short]].join(' · ');
}
export function ruleVoteHTML(state, me, isHost, draft) {
  const vote = state.vote;
  const humans = state.players.filter(p => !p.bot);
  const submitted = vote.submitted.includes(me);
  const offline = state.players.some(p => !p.online);
  const targetRound = vote.targetRound ?? state.round + 1;
  const firstRound = targetRound === 1;
  const resolved = Object.entries(vote.resolved).filter(([key]) => firstRound || !['deckMode', 'short'].includes(key));
  return `<main class="lobby-table rules-table">
    <div class="hero lobby-scene" aria-hidden="true"><div class="lobby-felt"></div></div>
    <section class="rules-vote" aria-labelledby="vote-title">
      <div class="vote-heading"><div><div class="eyebrow">第 ${targetRound} 轮 · 发牌前</div><h2 id="vote-title">${vote.complete ? '本轮规则已确定' : vote.round > 1 ? '平票项 · 重新投票' : '一起决定本轮玩法'}</h2></div><span class="vote-count">${vote.complete ? '投票完成' : `${vote.submitted.length} / ${humans.length} 已提交`}</span></div>
      <div class="vote-members">${humans.map(p => `<span class="${vote.submitted.includes(p.id) ? 'submitted' : ''}">${escape(p.name)}${firstRound ? '' : ` · ${p.score} 分`}${!p.online ? ' · 离线' : vote.submitted.includes(p.id) ? ' · 已提交' : ''}</span>`).join('')}</div>
      ${!firstRound ? `<p class="resolved-rules">整局固定：${RULE_LABELS.deckMode.values[state.options.deckMode]} / ${RULE_LABELS.short.values[state.options.short]}</p>` : ''}
      ${resolved.length ? `<p class="resolved-rules">已确定：${resolved.map(([key,value]) => `${RULE_LABELS[key].title}：${RULE_LABELS[key].values[value]}`).join(' / ')}</p>` : ''}
      ${vote.complete ? `<p class="vote-result">${ruleSummary({ ...state.options, ...vote.resolved })}</p><p class="muted">牌库和局长整局固定；预估方式、加减预估、先见之明下一轮重新选择。</p>` : `<form id="vote-form">
        <div class="vote-groups">${Object.entries(vote.pending).map(([key,values]) => `<fieldset><legend>${RULE_LABELS[key].title}</legend><div class="vote-choices">${values.map(value => `<label><input type="radio" name="${key}" value="${value}" ${draft[key] === value ? 'checked' : ''} ${submitted || offline ? 'disabled' : ''} required><span>${RULE_LABELS[key].values[value]}</span></label>`).join('')}</div><p>${RULE_LABELS[key].hint}</p></fieldset>`).join('')}</div>
        <div class="vote-footer"><p role="status">${offline ? '等待离线玩家重连，投票暂时暂停。' : submitted ? '已锁定你的选择，等待其他玩家。' : vote.round > 1 ? '仅重投并列最高票的选项，其他结果已保留。' : '全部真人提交后一起计票；平票项继续重投。'}</p><button type="submit" id="submit-vote" class="primary" ${submitted || offline ? 'disabled' : ''}>${submitted ? '已提交' : '提交选择'}</button></div>
      </form>`}
      <div class="vote-host-actions">${isHost ? `<button id="cancel-vote" class="text-button">${firstRound ? '返回大厅调整' : '返回上轮结算'}</button>${vote.complete ? `<button id="start" class="primary" ${offline ? 'disabled' : ''}>${offline ? '等待玩家重连' : `开始第 ${targetRound} 轮 →`}</button>` : ''}` : vote.complete ? '<p class="muted">等待房主发牌</p>' : ''}</div>
    </section>
  </main>`;
}
