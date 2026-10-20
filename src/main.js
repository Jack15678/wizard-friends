import Peer from 'peerjs';
import { createGame, addPlayer, act, viewFor, botAction, SUITS, SUIT_NAMES } from './game.js';
import './style.css';
import './cinematic.css';
import { cardImage } from './card-art.js';

let tableScene, scenePending = false, sceneFailed = false;
function syncScene() {
  const target = document.querySelector('.table') || document.querySelector('.hero');
  let mount = document.querySelector('#scene-host');
  if (target && !mount) {
    mount = document.createElement('div'); mount.id = 'scene-host';
    mount.className = 'scene-host'; mount.setAttribute('aria-hidden', 'true');
    target.prepend(mount);
  }
  if (tableScene) tableScene.attach(mount, state);
  else if (target && !scenePending && !sceneFailed) {
    scenePending = true;
    import('./table-scene.js').then(({ TableScene }) => {
      try {
        tableScene = new TableScene(); syncScene(); updateGraphicsButton();
      } catch {
        sceneFailed = true; document.body.classList.remove('has-webgl'); updateGraphicsButton();
      }
    }).catch(() => { sceneFailed = true; updateGraphicsButton(); });
  }
}
function updateGraphicsButton() {
  const button = document.querySelector('#graphics');
  if (!button) return;
  button.textContent = sceneFailed ? '◇ 2D 模式' : tableScene?.low ? '◇ 省电' : '◇ 3D 质感';
  button.disabled = sceneFailed || !tableScene;
  button.setAttribute('aria-label', sceneFailed ? 'WebGL 不可用，已自动使用二维界面' : '切换三维画面质量与省电模式');
}

const $ = s => document.querySelector(s);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const symbols = { blue: '❄', red: '♜', green: '❧', yellow: '✧', wizard: '✦', jester: '☾' };
const phaseNames = { lobby: '等待好友入座', trump: '选择王牌', bid: '预言阶段', play: '出牌阶段', trickEnd: '本墩结算', roundEnd: '本轮结算', finished: '终局 · 预言揭晓' };
const app = $('#app');
let peer, connection, game, state, isHost = false, practice = false, room = '', me = '', peers = new Map(), identities = {};
let botTimer, connectTimer, status = '', busy = false, rulesOpen = false;
let short = false, strict = false;
const tokenKey = 'wizard-player-token';
let token = sessionStorage.getItem(tokenKey);
if (!token) { token = crypto.randomUUID(); sessionStorage.setItem(tokenKey, token); }
let nickname = localStorage.getItem('wizard-name') || '';
const roomFromURL = new URLSearchParams(location.search).get('room') || '';
const storedRoom = sessionStorage.getItem('wizard-last-room') || '';
function notify(message) {
  status = message; const el = $('#notice'); if (el) el.textContent = message;
}
function cardHTML(c, playable = false, selected = false) {
  const special = c.kind !== 'number';
  const label = c.kind === 'wizard' ? '巫师' : c.kind === 'jester' ? '小丑' : SUIT_NAMES[c.suit].split(' · ')[1];
  const value = special ? (c.kind === 'wizard' ? 'W' : 'J') : c.rank;
  return `<button class="card ${c.suit || c.kind} ${selected ? 'playable' : ''}" style="background-image:url('${cardImage(c)}')" ${playable ? `data-card="${escape(c.id)}" ${selected ? '' : 'disabled'}` : 'disabled'} aria-label="${label} ${value}${selected ? '，点击出牌' : ''}" title="${label} ${value}"><span class="corner">${value}<small>${symbols[c.suit || c.kind]}</small></span><span class="sigil">${symbols[c.suit || c.kind]}</span><span class="card-name">${label}</span><span class="corner bottom">${value}</span></button>`;
}
function shell(body) {
  return `<div class="page"><header class="topbar"><a class="brand" href="${location.pathname}"><span class="brand-icon">✦</span><span>巫师牌<small>WIZARD / FRIENDS TABLE</small></span></a><div class="top-actions"><span class="tag">好友之间，预言成真</span><button class="text-button" id="rules">游戏规则 ↗</button></div></header>${body}<footer><span>一副牌，无数种预言。</span><span>非官方好友同乐版 · 牌面原创绘制</span></footer></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
}
function rulesHTML() {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="rule-title"><button class="close" id="close-rules" aria-label="关闭规则">×</button><div class="eyebrow">THE ART OF PREDICTION</div><h2 id="rule-title">先预言，再出牌。</h2><p>3–6 人，共 60 张牌：四种花色各 1–13，以及 4 张巫师、4 张小丑。第 N 轮每人发 N 张牌。</p><ol><li><b>确定王牌。</b>翻开的数字牌花色是本轮王牌；翻到巫师由庄家选色，小丑或牌库用尽则无王牌。</li><li><b>预言墩数。</b>从庄家左手开始，依次预测自己本轮能赢几墩。每人出一张牌，组成一墩。</li><li><b>依次出牌。</b>有首攻花色就必须跟色；巫师和小丑随时能出。巫师起手可任意出牌；小丑起手则看第一张非小丑牌。</li><li><b>判定赢家。</b>最先出的巫师 ＞ 最大王牌 ＞ 首攻花色最大牌。全是小丑则第一张赢。赢家下一墩先出。</li><li><b>计分。</b>猜中得 20 + 10 × 赢墩数；猜错每差一墩扣 10 分。总分最高者胜出，同分共享胜利。</li></ol><p>标准局：3/4/5/6 人分别 20/15/12/10 轮。快速局为本站的 5 轮练习变体。「预言总和不能相等」是可选变体，由最后预言的人避开总和等于本轮墩数。</p><p class="muted">联机需保持房主页面打开；房主可看到全部对局数据，请与信任的朋友同玩。严格网络可能无法建立直连，可切换网络或配置自有 TURN 服务。</p><a href="https://blog.amigo-spiele.de/content/ap/rule/06900-GB-AmigoRule.pdf" target="_blank" rel="noopener">查看 AMIGO 官方规则 ↗</a></section></div>`;
}
function render() {
  if (!state) {
    app.innerHTML = shell(`<main class="landing"><section class="hero"><div class="eyebrow"><span class="tiny-star">✦</span> 为朋友们留一张牌桌</div><h1>胜利，始于<br>你的<span class="gold">预言。</span></h1><p class="intro">不只比谁的牌大。<br>准确预言你能赢下的每一墩，<br>才是巫师的真正本领。</p><div class="hero-cards">${cardHTML({ kind: 'number', suit: 'blue', rank: 13 })}${cardHTML({ kind: 'wizard' })}${cardHTML({ kind: 'number', suit: 'red', rank: 7 })}</div><div class="facts"><span><b>3–6</b> 位巫师</span><span><b>60</b> 张魔法牌</span><span><b>≈45</b> 分钟 / 标准局</span></div></section><section class="entry panel"><div class="eyebrow">YOUR SEAT IS WAITING</div><h2>今晚，开一桌。</h2><p class="muted">创建房间，把邀请链接发给朋友。</p><label for="nickname">你的昵称</label><input id="nickname" maxlength="16" placeholder="例如：星空下的巫师" autocomplete="nickname" value="${escape(nickname)}"><button id="create" class="primary wide" ${busy ? 'disabled' : ''}>${busy ? '正在连接…' : '创建好友房间'} <span>↗</span></button><div class="divider"><span>或加入朋友的牌桌</span></div><label for="room-input">房间码</label><div class="join-row"><input id="room-input" placeholder="粘贴房间码" maxlength="24" value="${escape(roomFromURL || storedRoom)}"><button id="join" ${busy ? 'disabled' : ''}>加入 →</button></div><button id="practice" class="practice wide" ${busy ? 'disabled' : ''}>✧ 先和机器人练习一局</button><p class="fine">无需注册 · 手机电脑都能玩<br>房主主持对局，请保持页面打开</p></section></main><section class="how"><div><span>01 / 观察</span><p>读懂手中的可能。</p></div><div><span>02 / 预言</span><p>说出你要赢的墩数。</p></div><div><span>03 / 实现</span><p>让每一张牌恰到好处。</p></div></section>`);
    bindCommon();
    $('#create').onclick = () => launch(true);
    $('#join').onclick = () => launch(false);
    $('#practice').onclick = startPractice;
    $('#nickname').oninput = e => { nickname = e.target.value; };
    return;
  }
  const p = state.players.find(p => p.id === me);
  const myTurn = state.players[state.turn]?.id === me;
  const hostName = state.players[0]?.name;
  const invitation = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  const head = `<div class="room-heading"><div><div class="eyebrow">${practice ? 'PRACTICE TABLE' : 'FRIENDS TABLE'}</div><h2>${practice ? '巫师的练习室' : '好友牌桌'} <span class="room-code">${escape(room)}</span></h2></div><div class="room-buttons">${!practice ? '<button id="invite">复制邀请链接 ↗</button>' : ''}<button id="leave" class="text-button">离开牌桌</button></div></div>`;
  let body;
  if (state.phase === 'lobby') {
    body = `<div class="lobby-grid"><section class="panel"><div class="section-label">已入座 <b>${state.players.length} / 6</b></div><div class="seats">${state.players.map((p, i) => `<div class="seat"><div class="avatar">${p.bot ? '✧' : escape(p.name.slice(0, 1))}</div><div><b>${escape(p.name)}</b><small>${i === 0 ? '房主' : p.bot ? '练习伙伴' : p.online ? '已连接' : '连接中断'}</small></div>${isHost && i > 0 ? `<button data-remove="${escape(p.id)}" class="text-button">移除</button>` : ''}</div>`).join('')}${Array.from({ length: 6 - state.players.length }, () => '<div class="seat empty"><div class="avatar">＋</div><span>留给下一位朋友</span></div>').join('')}</div>${isHost && state.players.length < 6 ? '<button id="addbot" class="wide">＋ 添加机器人</button>' : ''}</section><section class="panel lobby-settings"><div class="eyebrow">BEFORE THE MAGIC</div><h2>好戏，即将开始。</h2><p class="muted">凑齐至少三位巫师，就可以开局。<br>人数不足时，让机器人来陪练。</p><label class="check"><input type="checkbox" id="short" ${short ? 'checked' : ''} ${isHost ? '' : 'disabled'}> 快速局 <span>只玩 5 轮</span></label><label class="check"><input type="checkbox" id="strict" ${strict ? 'checked' : ''} ${isHost ? '' : 'disabled'}> 预言挑战 <span>总和不能等于本轮墩数</span></label>${isHost ? `<button id="start" class="primary wide" ${state.players.length < 3 || state.players.some(p => !p.online) ? 'disabled' : ''}>开始预言 →</button>` : `<p>等待 ${escape(hostName)} 开始对局…</p>`}<p class="fine">${practice ? '练习模式不需要网络连接。' : '把邀请链接发到群里，朋友打开后输入昵称即可入座。'}</p></section></div>`;
  } else {
    const done = ['trickEnd', 'roundEnd', 'finished'].includes(state.phase);
    const roundEnd = ['roundEnd', 'finished'].includes(state.phase);
    const highScore = Math.max(...state.players.map(p => p.score));
    const turnName = escape(state.players[state.turn]?.name);
    const prompt = state.phase === 'finished' ? `${state.players.filter(p => p.score === highScore).map(p => escape(p.name)).join('、')} 赢得本局` : done ? `${escape(state.players[state.lastWinner]?.name)} 赢下这一墩` : myTurn ? ({ trump: '翻到了巫师，请选择本轮王牌', bid: '你预言自己能赢几墩？', play: '轮到你了，点击亮起的手牌出牌' }[state.phase]) : `等待 ${turnName} ${state.phase === 'bid' ? '预言' : state.phase === 'trump' ? '选择王牌' : '出牌'}…`;
    const actionUI = myTurn && state.phase === 'bid' ? `<div class="bid-options">${state.bids.map(n => `<button class="bid" data-bid="${n}">${n}</button>`).join('')}</div>` : myTurn && state.phase === 'trump' ? `<div class="trump-options">${SUITS.map(s => `<button data-trump="${s}" class="suit-chip ${s}">${symbols[s]} ${SUIT_NAMES[s]}</button>`).join('')}</div>` : '';
    body = `<div class="game-layout"><main><div class="roundbar"><span>第 <b>${state.round}</b> / ${state.maxRounds} 轮</span><span>${phaseNames[state.phase]}</span><span class="trump-marker ${state.trump || ''}">王牌 ${state.trump ? `${symbols[state.trump]} ${SUIT_NAMES[state.trump].split(' · ')[0]}` : '无'}</span></div><section class="table"><div class="table-ring"></div><div class="opponents">${state.players.map((x, i) => `<div class="player ${!done && state.turn === i ? 'active' : ''} ${x.id === me ? 'self' : ''}"><div class="avatar">${x.bot ? '✧' : escape(x.name.slice(0, 1))}</div><b>${escape(x.name)}${x.id === me ? ' · 你' : ''}</b><small>${x.online ? `${x.count} 张牌` : '离线'}${i === state.dealer ? ' · 庄家' : ''}</small><span class="prediction">${x.won} <i>/</i> ${x.bid ?? '—'} <small>赢 / 预言</small></span></div>`).join('')}</div><div class="played-cards">${state.trick.length ? state.trick.map((x, i) => `<div class="played ${done && x.player === state.lastWinner ? 'winner' : ''}">${cardHTML(x.card)}<small>${escape(state.players[x.player].name)} ${i === 0 ? '· 首攻' : ''}${done && x.player === state.lastWinner ? ' · 获胜' : ''}</small></div>`).join('') : `<div class="table-empty"><span>✦</span><p>${state.phase === 'bid' ? '想好你的预言。' : state.phase === 'trump' ? '魔法的颜色，由你决定。' : '下一墩，新的可能。'}</p></div>`}</div><div class="table-caption">${state.completedTricks} / ${state.round} 墩已完成${state.reveal ? ` · 翻牌：${state.reveal.kind === 'number' ? `${SUIT_NAMES[state.reveal.suit].split(' · ')[0]} ${state.reveal.rank}` : state.reveal.kind === 'wizard' ? '巫师' : '小丑'}` : ' · 牌库已用尽'}</div></section><section class="action-panel"><div class="action-title"><span class="${myTurn && !done ? 'pulse-dot' : 'gold'}">✦</span><h3>${prompt}</h3></div>${actionUI}${done && state.phase !== 'finished' ? isHost ? `<button id="next" class="primary">${roundEnd ? '开始下一轮' : '继续下一墩'} →</button>` : `<p class="muted">等待房主继续</p>` : ''}${state.phase === 'finished' && isHost ? '<button id="rematch" class="primary">再来一局 →</button>' : ''}</section><section class="hand-section"><div class="section-label">你的手牌 <span>${p?.hand?.length || 0} 张${state.phase === 'play' ? ' · 亮起的牌可以出' : ''}</span></div><div class="hand">${(p?.hand || []).slice().sort((a,b) => (SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)) || (a.rank || 0) - (b.rank || 0)).map(c => cardHTML(c, true, myTurn && state.legal.includes(c.id))).join('') || '<p class="muted">本轮手牌已出完。</p>'}</div></section></main><aside><section class="panel scoreboard"><div class="section-label">预言排行榜 <span>总分</span></div>${state.players.map((x, i) => ({ ...x, seat: i })).sort((a,b) => b.score - a.score).map((x, i) => `<div class="score-row"><span class="rank">${String(i + 1).padStart(2, '0')}</span><span>${escape(x.name)}${x.id === me ? '<small>你</small>' : ''}</span><b>${x.score}</b></div>`).join('')}${roundEnd ? `<div class="round-results"><h4>第 ${state.round} 轮得分</h4>${state.history.at(-1).result.map(r => `<div><span>${escape(state.players.find(x => x.id === r.id).name)} <small>${r.won}/${r.bid} 墩</small></span><b class="${r.delta > 0 ? 'positive' : 'negative'}">${r.delta > 0 ? '+' : ''}${r.delta}</b></div>`).join('')}</div>` : ''}</section><section class="panel journal"><div class="section-label">牌桌记事 <span>↙</span></div>${state.log.slice(-7).map(l => `<p>${escape(l)}</p>`).join('')}</section><details class="panel history"><summary>查看逐轮记分</summary><div class="history-scroll"><table><thead><tr><th>轮</th>${state.players.map(x => `<th>${escape(x.name)}</th>`).join('')}</tr></thead><tbody>${state.history.map(h => `<tr><td>${h.round}</td>${h.result.map(r => `<td title="预言 ${r.bid} / 赢 ${r.won}">${r.delta > 0 ? '+' : ''}${r.delta}<small>${r.total}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div></details></aside></div>`;
  }
  app.innerHTML = shell(`${head}${body}`);
  bindCommon();
  $('#invite')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(invitation); notify('邀请链接已复制，发给朋友吧。'); } catch { notify(`复制这个邀请链接：${invitation}`); }
  });
  $('#leave').onclick = () => {
    if (window.confirm(isHost && !practice ? '你是房主，离开会结束整个房间。确定离开？' : '确定离开当前牌桌？')) {
      sessionStorage.removeItem('wizard-host'); sessionStorage.removeItem('wizard-last-room'); location.href = location.pathname;
    }
  };
  $('#short')?.addEventListener('change', e => { short = e.target.checked; game.options.short = short; broadcast(); });
  $('#strict')?.addEventListener('change', e => { strict = e.target.checked; game.options.strict = strict; broadcast(); });
  $('#start')?.addEventListener('click', () => send({ type: 'start', short, strict }));
  $('#addbot')?.addEventListener('click', () => { addPlayer(game, crypto.randomUUID(), ['月影', '星尘', '风语', '余烬', '暮光'][game.players.length - 1], true); broadcast(); });
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    if (!isHost || game.phase !== 'lobby') return;
    const id = b.dataset.remove;
    peers.get(id)?.send({ type: 'removed' }); peers.get(id)?.close(); peers.delete(id);
    game.players = game.players.filter(p => p.id !== id);
    for (const t of Object.keys(identities)) if (identities[t] === id) delete identities[t];
    broadcast();
  });
  document.querySelectorAll('[data-bid]').forEach(b => b.onclick = () => send({ type: 'bid', value: Number(b.dataset.bid) }));
  document.querySelectorAll('[data-trump]').forEach(b => b.onclick = () => send({ type: 'trump', suit: b.dataset.trump }));
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => send({ type: 'play', card: b.dataset.card }));
  $('#next')?.addEventListener('click', () => send({ type: 'next' }));
  $('#rematch')?.addEventListener('click', () => {
    const players = game.players.map(p => ({ ...p, hand: [], won: 0, bid: null, score: 0 }));
    game = createGame(); game.players = players; game.options = { short, strict }; broadcast();
  });
}
function bindCommon() {
  document.body.dataset.screen = !state ? 'home' : state.phase === 'lobby' ? 'lobby' : 'game';
  const graphics = document.createElement('button');
  graphics.id = 'graphics'; graphics.className = 'text-button graphics-toggle';
  $('.top-actions').prepend(graphics);
  graphics.onclick = () => { if (tableScene) { tableScene.setLow(!tableScene.low); updateGraphicsButton(); } };
  syncScene(); updateGraphicsButton();
  document.querySelectorAll('.played').forEach(played => {
    const label = document.createElement('span');
    label.className = 'played-value';
    label.textContent = played.querySelector('.card')?.getAttribute('aria-label') || '';
    played.querySelector(':scope > small')?.append(label);
  });
  const hand = $('.hand');
  if (hand) {
    const cards = [...hand.querySelectorAll('.card')], total = cards.length;
    hand.classList.toggle('large-hand', total > 9 || (matchMedia('(max-width: 580px)').matches && total > 5));
    cards.forEach((card, i) => {
      const offset = i - (total - 1) / 2;
      card.style.setProperty('--fan', `${offset * Math.min(3.2, 25 / Math.max(total,1))}deg`);
      card.style.setProperty('--lift', `${Math.abs(offset) ** 1.65 * .9}px`);
      card.style.setProperty('--order', i);
      card.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--tilt', `${((event.clientX - rect.left) / rect.width - .5) * 12}deg`);
      });
      card.addEventListener('pointerleave', () => card.style.setProperty('--tilt', '0deg'));
    });
  }
  $('#rules').onclick = () => { rulesOpen = true; render(); $('#close-rules')?.focus(); };
  $('#close-rules')?.addEventListener('click', () => { rulesOpen = false; render(); $('#rules')?.focus(); });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && rulesOpen) { rulesOpen = false; render(); } });
function saveName() {
  nickname = nickname.trim();
  if (!nickname) nickname = '旅途中的巫师';
  localStorage.setItem('wizard-name', nickname);
}
function broadcast() {
  state = viewFor(game, me);
  short = game.options.short; strict = game.options.strict;
  if (!practice) {
    try { sessionStorage.setItem('wizard-host', JSON.stringify({ game, identities, room, me })); } catch { notify('浏览器存储不可用，房主刷新后将无法恢复对局。'); }
    for (const [id, conn] of peers) if (conn.open) conn.send({ type: 'state', state: viewFor(game, id) });
  }
  render();
  clearTimeout(botTimer);
  if (botAction(game)) botTimer = setTimeout(() => {
    try { const action = botAction(game); if (action) { act(game, game.players[game.turn].id, action); broadcast(); } } catch (e) { notify(e.message); }
  }, 750);
}
function send(action) {
  if (isHost) {
    try { act(game, me, action); notify(''); broadcast(); } catch (e) { notify(e.message); }
  } else if (connection?.open) connection.send({ type: 'action', action });
  else notify('连接已中断，请刷新页面重新加入。');
}
function startPractice() {
  saveName(); practice = true; isHost = true; me = crypto.randomUUID(); room = '离线练习';
  game = createGame(); addPlayer(game, me, nickname);
  addPlayer(game, crypto.randomUUID(), '月影', true); addPlayer(game, crypto.randomUUID(), '星尘', true);
  short = true; game.options.short = true; notify(''); broadcast();
}
function networkOptions() {
  const turn = import.meta.env.VITE_TURN_URL;
  return turn ? { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: turn, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] } } : {};
}
function launch(host, restored = null) {
  saveName();
  const entered = restored?.room || $('#room-input')?.value.trim().toUpperCase();
  if (!host && !/^[A-Z2-9]{8}$/.test(entered)) return notify('请输入有效的 8 位房间码。');
  if (busy) return;
  busy = true; notify(host ? '正在创建房间…' : '正在连接好友房间…');
  isHost = host; practice = false;
  if (host) {
    if (restored) {
      ({ game, identities, room, me } = restored);
      game.players.forEach(p => { p.online = p.id === me || p.bot; });
    } else {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      room = Array.from(crypto.getRandomValues(new Uint8Array(8)), n => chars[n % chars.length]).join('');
      me = crypto.randomUUID(); game = createGame(); identities = { [token]: me }; addPlayer(game, me, nickname);
    }
  } else room = entered;
  peer?.destroy(); peer = host ? new Peer(`wizard-friends-${room}`, networkOptions()) : new Peer(networkOptions());
  render();
  connectTimer = setTimeout(() => {
    if (!state) { busy = false; peer.destroy(); render(); notify('连接超时。请检查房间码、房主是否在线，或切换网络后重试。'); }
  }, 20000);
  peer.on('error', err => {
    busy = false; clearTimeout(connectTimer);
    if (!state) { peer.destroy(); render(); }
    notify(({ 'peer-unavailable': '没有找到房间，请确认房主在线和房间码正确。', 'unavailable-id': '房间连接仍被占用，请稍后刷新重试。', 'network': '网络服务连接失败，请稍后重试。', 'webrtc': '无法建立直连，请尝试切换网络。' })[err.type] || `连接出现问题：${err.type}`);
  });
  peer.on('disconnected', () => { notify('信令连接中断，正在尝试恢复…'); if (!peer.destroyed) peer.reconnect(); });
  peer.on('open', () => {
    if (host) { clearTimeout(connectTimer); busy = false; notify('房间已准备好。邀请好友，或添加机器人。'); broadcast(); }
    else {
      connection = peer.connect(`wizard-friends-${room}`, { reliable: true });
      connection.on('open', () => connection.send({ type: 'join', token, name: nickname }));
      connection.on('data', msg => {
        if (msg?.type === 'welcome') { me = msg.id; sessionStorage.setItem('wizard-last-room', room); }
        if (msg?.type === 'state') { clearTimeout(connectTimer); busy = false; state = msg.state; short = state.options.short; strict = state.options.strict; notify(''); render(); }
        if (msg?.type === 'error') { clearTimeout(connectTimer); busy = false; if (!state) { connection.close(); render(); } notify(msg.message); }
        if (msg?.type === 'removed') { state = null; busy = false; connection.close(); peer.destroy(); render(); notify('你已被移出房间。'); }
      });
      connection.on('close', () => notify('与房主的连接已中断。房主恢复后，刷新此页并重新加入即可恢复座位。'));
      connection.on('error', () => notify('连接失败，请刷新重试或切换网络。'));
    }
  });
  if (host) peer.on('connection', conn => {
    let id = null, count = 0, windowStart = Date.now();
    const joinTimeout = setTimeout(() => { if (!id) conn.close(); }, 10000);
    conn.on('data', msg => {
      if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now(); }
      if (++count > 30) return;
      try {
        if (!msg || typeof msg !== 'object') throw new Error('无效消息。');
        if (msg.type === 'join' && !id) {
          if (typeof msg.token !== 'string' || !/^[a-f0-9-]{36}$/.test(msg.token)) throw new Error('无效身份，请刷新后重试。');
          if (identities[msg.token]) {
            id = identities[msg.token];
            if (id === me) { id = null; throw new Error('房主身份不能作为访客加入。'); }
            const old = peers.get(id); if (old && old !== conn) old.close();
          } else {
            const newId = crypto.randomUUID(); addPlayer(game, newId, msg.name);
            id = newId; identities[msg.token] = id;
          }
          clearTimeout(joinTimeout); peers.set(id, conn); game.players.find(p => p.id === id).online = true;
          conn.send({ type: 'welcome', id }); broadcast();
        } else if (msg.type === 'action' && id && peers.get(id) === conn) {
          act(game, id, msg.action); broadcast();
        }
      } catch (e) { conn.send({ type: 'error', message: e.message }); }
    });
    conn.on('close', () => {
      clearTimeout(joinTimeout);
      if (id && peers.get(id) === conn) { peers.delete(id); const p = game.players.find(p => p.id === id); if (p) p.online = false; broadcast(); }
    });
    conn.on('error', () => conn.close());
  });
}
render();
try {
  const saved = JSON.parse(sessionStorage.getItem('wizard-host') || 'null');
  if (saved && (!roomFromURL || saved.room === roomFromURL)) launch(true, saved);
} catch { sessionStorage.removeItem('wizard-host'); }
