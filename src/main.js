import Peer from 'peerjs';
import { createGame, addPlayer, act, viewFor, botAction, normalizeGame, TURN_MS, SUITS, SUIT_NAMES } from './game.js';
import './style.css';
import './cinematic.css';
import './fullscreen.css';
import './home-menu.css';
import './lobby.css';
import './social.css';
import './music.css';
import './clarity.css';
import { BackgroundMusic } from './music.js';
import { RoomSocial } from './room-social.js';
import { renderTrumpDisplay } from './trump-display.js';
import { uniqueRandomName, validateName } from './player-names.js';
import { ruleVoteHTML, ruleSummary } from './rule-ui.js';
import './variants.css';
import './trump-display.css';
import { cardImage } from './card-art.js';
import { createPresence, presenceRoom } from './presence.js';
import { createRoomTransport } from './room-transport.js';
import { readRoomSession, saveRoomSession, clearRoomSession } from './room-session.js';

let onlinePresence = { count: null, status: 'connecting' };
function updateOnlineCount() {
  const badge = document.querySelector('#online-count');
  if (!badge) return;
  badge.dataset.status = onlinePresence.status;
  badge.textContent = onlinePresence.count === null
    ? (onlinePresence.status === 'connecting' ? '在线人数连接中…' : '在线人数暂不可用')
    : `约 ${onlinePresence.count} 人在线`;
}

let tableScene, scenePending = false, sceneFailed = false;
const motionMedia = matchMedia('(prefers-reduced-motion: reduce)');
let trumpMotionPreference = localStorage.getItem('wizard-trump-motion');
function updateTrumpMotion() {
  const enabled = trumpMotionPreference === null ? !motionMedia.matches : trumpMotionPreference === 'true';
  document.body.dataset.trumpMotion = enabled ? 'on' : 'off';
  if (tableScene) tableScene.trumpMotion = enabled;
  const button = document.querySelector('#trump-motion');
  if (button) {
    button.textContent = `主牌动画：${enabled ? '开' : '关'}`;
    button.setAttribute('aria-pressed', String(enabled));
    button.title = trumpMotionPreference === null && motionMedia.matches
      ? '已跟随系统减少动态效果；点击开启主牌旋转与悬浮' : '切换主牌旋转与悬浮，自动记住选择';
  }
}
motionMedia.addEventListener('change', updateTrumpMotion);
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
        tableScene = new TableScene(); updateTrumpMotion(); syncScene(); updateGraphicsButton();
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
let transport, game, state, isHost = false, practice = false, room = '', me = '', peers = new Map(), identities = {};
let botTimer, status = '', busy = false, rulesOpen = false, networkReady = false;
let voteDraft = {}, voteDraftRound = null;
let roomEpoch = 0;
let scoresOpen = false, menuOpen = false, previousHUDPhase = '';
let settingsOpen = false, turnTimer, serverClockOffset = 0;
let joinOpen = new URLSearchParams(location.search).has('room');
let joinDraft = null;
const tokenKey = 'wizard-player-token';
let token = sessionStorage.getItem(tokenKey);
if (!token) { token = crypto.randomUUID(); sessionStorage.setItem(tokenKey, token); }
let nickname = sessionStorage.getItem('wizard-name') || uniqueRandomName();
let automaticName = sessionStorage.getItem('wizard-name-automatic') !== 'false';
persistName();
const roomFromURL = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
const savedSession = readRoomSession(sessionStorage, roomFromURL);
const storedRoom = savedSession?.room || '';
function notify(message) {
  status = message; const el = $('#notice'); if (el) el.textContent = message;
}
function persistName() {
  sessionStorage.setItem('wizard-name', nickname);
  sessionStorage.setItem('wizard-name-automatic', String(automaticName));
}
function cardHTML(c, playable = false, selected = false) {
  const special = c.kind !== 'number';
  const label = c.kind === 'wizard' ? '巫师' : c.kind === 'jester' ? '小丑' : SUIT_NAMES[c.suit].split(' · ')[1];
  const value = special ? (c.kind === 'wizard' ? 'W' : 'J') : c.rank;
  return `<button class="card ${c.suit || c.kind} ${selected ? 'playable' : ''}" style="background-image:url('${cardImage(c)}')" ${playable ? `data-card="${escape(c.id)}" ${selected ? '' : 'disabled'}` : 'disabled'} aria-label="${label} ${value}${selected ? '，点击出牌' : ''}" title="${label} ${value}"><span class="corner">${value}<small>${symbols[c.suit || c.kind]}</small></span><span class="sigil">${symbols[c.suit || c.kind]}</span><span class="card-name">${label}</span><span class="corner bottom">${value}</span></button>`;
}
function shell(body) {
  if (!state) return `<div class="page">${body}<header class="topbar home-tools"><div class="top-actions"><button class="text-button" id="rules">游戏规则</button></div></header></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
  return `<div class="page"><header class="topbar"><a class="brand" href="${location.pathname}"><span class="brand-icon">✦</span><span>巫师牌<small>WIZARD / FRIENDS TABLE</small></span></a><div class="top-actions"><span class="tag">好友之间，预言成真</span><button class="text-button" id="rules">玩法说明</button></div></header>${body}<footer><span>一副牌，无数种预言。</span><span>非官方好友同乐版 · 牌面原创绘制</span></footer></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
}
function rulesHTML() {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="rule-title"><button class="close" id="close-rules" aria-label="关闭规则">×</button><div class="eyebrow">THE ART OF PREDICTION</div><h2 id="rule-title">先预估，再出牌。</h2>
    <p>3–6 人，共 60 张牌：四种花色各 1–13，以及 4 张巫师、4 张小丑。标准牌库第 N 轮每人发 N 张牌。</p>
    <ol><li><b>确定主牌。</b>翻开的数字牌花色是本轮主牌；翻到巫师由庄家选色，小丑或牌库用尽则无主牌。</li><li><b>预估墩数。</b>公开预估从庄家左手开始。每人出一张牌，组成一墩。</li><li><b>依次出牌。</b>有首攻花色必须跟色；巫师和小丑随时能出。巫师起手可任意出牌，小丑起手看第一张非小丑牌。</li><li><b>判定赢家。</b>最先出的巫师 ＞ 最大主牌 ＞ 首攻花色最大牌。全是小丑则第一张赢。赢家下一墩先出。</li><li><b>计分。</b>猜中得 20 + 10 × 赢墩数；猜错每差一墩扣 10 分。最高总分胜，同分共享胜利。</li></ol>
    <h3>每局发牌前，全员投票</h3><p>真人按类别提交选择，机器人不投票。最高票选项获选，平票项重新投票。房主在结果确定后发牌；再来一局会重新选择。</p>
    <ul><li><b>加减预估：</b>最后一人的预估不能使总和等于本轮墩数，仅搭配公开预估，可同时开启先见之明。</li><li><b>隐藏预估：</b>独立提交，全部提交后同时公开。</li><li><b>秘密数字：</b>独立提交，只能看自己的预估，本轮打完才公开所有人的数字。</li><li><b>先见之明：</b>仅第一轮预估时隐藏自己的手牌，展示其他人的手牌。全部预估完恢复正常；单色模式也适用于首轮全部 4 张牌。</li><li><b>单色牌库（3–4 人）：</b>每人独占一个随机花色 1–13，加 1 张巫师和 1 张小丑。第一轮发 4 张，逐轮增加，12 轮结束。每轮将所有牌归还原牌库重新洗牌；无主牌，数字跨花色比较，最大数字胜，同数字先出者较强。巫师、小丑及计分沿用基本规则。</li></ul>
    <p>标准完整局：3/4/5/6 人分别 20/15/12/10 轮。两种牌库均可选本站的 5 轮快速局，单色快速局每轮发 4–8 张。</p>
    <p class="muted">联机需保持房主页面打开；房主持有全部对局数据，请与信任的朋友同玩。严格网络可能无法直连。</p><a href="https://blog.amigo-spiele.de/content/ap/rule/06900-GB-AmigoRule.pdf" target="_blank" rel="noopener">查看 AMIGO 官方基本规则 ↗</a></section></div>`;
}
function render() {
  if (!state) {
    app.innerHTML = shell(`<main class="home-screen">
      <section class="hero home-scene" aria-label="烛光牌桌"><div class="hero-cards">${cardHTML({ kind: 'number', suit: 'blue', rank: 13 })}${cardHTML({ kind: 'wizard' })}${cardHTML({ kind: 'number', suit: 'red', rank: 7 })}</div></section>
      <section class="home-menu" aria-label="主菜单">
        <div class="home-title"><span class="title-ornament" aria-hidden="true">✦</span><h1>巫师牌</h1><span class="home-wordmark">W I Z A R D</span></div>
        <nav class="menu-options" aria-label="开始游戏">
          <button id="create" class="menu-choice menu-primary" ${busy ? 'disabled' : ''}>${busy ? '正在连接…' : '创建房间'}<span aria-hidden="true">↗</span></button>
          <button id="join-menu" class="menu-choice" aria-expanded="${joinOpen}" aria-controls="join-form" ${busy ? 'disabled' : ''}>加入房间<span aria-hidden="true">＋</span></button>
          <form id="join-form" class="menu-join" ${joinOpen ? '' : 'hidden'}><label class="sr-only" for="room-input">房间码</label><input id="room-input" placeholder="输入房间码" maxlength="24" autocomplete="off" value="${escape(joinDraft ?? (roomFromURL || storedRoom))}"><button id="join" type="submit" ${busy ? 'disabled' : ''}>加入</button></form>
          <button id="practice" class="menu-choice" ${busy ? 'disabled' : ''}>单人练习<span aria-hidden="true">↗</span></button>
          ${busy ? '<button id="cancel-connect" class="text-button">取消连接</button>' : ''}
        </nav>
        <div class="menu-identity"><label for="nickname">昵称</label><input id="nickname" maxlength="16" placeholder="旅人" autocomplete="nickname" value="${escape(nickname)}"></div>
        <div class="home-presence"></div>
      </section></main>`);
    bindCommon();
    $('#create').onclick = () => launch(true);
    $('#join-form').onsubmit = e => { e.preventDefault(); launch(false); };
    $('#room-input').oninput = e => { joinDraft = e.target.value; };
    $('#join-menu').onclick = () => {
      joinOpen = !joinOpen;
      $('#join-form').hidden = !joinOpen;
      $('#join-menu').setAttribute('aria-expanded', String(joinOpen));
      if (joinOpen) $('#room-input').focus();
    };
    $('#practice').onclick = startPractice;
    $('#cancel-connect')?.addEventListener('click', () => leaveRoom());
    $('#nickname').oninput = e => { nickname = e.target.value; automaticName = false; persistName(); };
    return;
  }
  const p = state.players.find(p => p.id === me);
  const myTurn = state.players[state.turn]?.id === me;
  const hostName = state.players[0]?.name;
  const invitation = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  const head = `<div class="room-heading"><div class="room-identity"><span>${practice ? '练习牌桌' : '房间'}</span><span class="room-code">${practice ? '' : escape(room)}</span><span class="seat-count">${state.players.length} / 6</span></div><div class="room-buttons">${!practice ? '<button id="invite">邀请好友</button>' : ''}<button id="leave" class="text-button">离开</button></div></div>`;
  let body;
  if (state.phase !== 'rules') { voteDraft = {}; voteDraftRound = null; }
  if (state.phase === 'lobby') {
    const startHint = state.players.length < 3 ? `还差 ${3 - state.players.length} 人` : state.players.some(p => !p.online) ? '等待玩家重连' : '';
    body = `<main class="lobby-table">
      <div class="hero lobby-scene" aria-hidden="true"><div class="lobby-felt"></div></div>
      <div class="seats" aria-label="房间座位">${state.players.map((p, i) => `<div class="seat ${p.id === me ? 'my-seat' : ''} ${!p.online ? 'offline' : ''}"><div class="avatar">${p.bot ? '✧' : escape(p.name.slice(0, 1))}</div><div class="seat-name"><b>${escape(p.name)}</b><small>${i === 0 ? '房主' : p.bot ? '机器人' : p.online ? '已入座' : '离线'}</small></div>${isHost && i > 0 ? `<button data-remove="${escape(p.id)}" class="text-button" aria-label="移除 ${escape(p.name)}" title="移除玩家">×</button>` : ''}</div>`).join('')}${Array.from({ length: 6 - state.players.length }, () => '<div class="seat empty"><div class="avatar">＋</div><span>空位</span></div>').join('')}</div>
      <div class="lobby-controls">
        <div class="lobby-options">${isHost && state.players.length < 6 ? '<button id="addbot" class="text-button">＋ 机器人</button>' : ''}
          <span class="start-hint">发牌前，一起投票选择本局规则</span>
        </div>
        <div class="lobby-start">${isHost ? `${startHint ? `<span class="start-hint">${startHint}</span>` : ''}<button id="begin-vote" class="primary" ${startHint ? 'disabled' : ''}>选择本局规则 →</button>` : `<span class="start-hint">等待 ${escape(hostName)} 发起投票</span>`}</div>
      </div>
    </main>`;
  } else if (state.phase === 'rules') {
    if (voteDraftRound !== state.vote.round) {
      voteDraftRound = state.vote.round;
      voteDraft = { ...state.options, ...(practice ? { short: true } : {}), ...state.vote.ownChoices };
      for (const [key, values] of Object.entries(state.vote.pending)) if (!values.includes(voteDraft[key])) voteDraft[key] = values[0];
    }
    body = ruleVoteHTML(state, me, isHost, voteDraft);
  } else {
    const done = ['trickEnd', 'roundEnd', 'finished'].includes(state.phase);
    const roundEnd = ['roundEnd', 'finished'].includes(state.phase);
    const highScore = Math.max(...state.players.map(p => p.score));
    const turnName = escape(state.players[state.turn]?.name);
    const prompt = state.phase === 'finished' ? `${state.players.filter(p => p.score === highScore).map(p => escape(p.name)).join('、')} 赢得本局` : done ? `${escape(state.players[state.lastWinner]?.name)} 赢下这一墩` : state.phase === 'bid' ? (state.canBid ? (state.foresightActive ? '看别人的牌，预估自己能赢几墩？' : '你预言自己能赢几墩？') : p?.bidSubmitted ? '你的预估已提交，等待其他玩家。' : `等待 ${turnName} 预估…`) : myTurn ? ({ trump: '翻到了巫师，请选择本轮王牌', bid: '你预言自己能赢几墩？', play: '轮到你了，点击亮起的手牌出牌' }[state.phase]) : `等待 ${turnName} ${state.phase === 'bid' ? '预言' : state.phase === 'trump' ? '选择王牌' : '出牌'}…`;
    const actionUI = state.canBid ? `<div class="bid-options">${state.bids.map(n => `<button class="bid" data-bid="${n}">${n}</button>`).join('')}</div>` : myTurn && state.phase === 'trump' ? `<div class="trump-options">${SUITS.map(s => `<button data-trump="${s}" class="suit-chip ${s}">${symbols[s]} ${SUIT_NAMES[s]}</button>`).join('')}</div>` : '';
    const foresight = state.foresightActive ? `<section class="foresight-hands" aria-label="先见之明：其他玩家手牌">${state.players.filter(x => x.id !== me).map(x => `<div class="foresight-player"><p>${escape(x.name)}</p><div class="foresight-cards">${(x.hand || []).map(c => cardHTML(c)).join('')}</div></div>`).join('')}</section>` : '';
    body = `<div class="game-layout"><main><div class="roundbar"><span>第 <b>${state.round}</b> / ${state.maxRounds} 轮</span><span>${phaseNames[state.phase]}</span></div><section class="table"><div class="table-ring"></div><div class="opponents">${state.players.map((x, i) => `<div class="player ${!done && !(state.phase === 'bid' && state.options.predictionMode !== 'public') && state.turn === i ? 'active' : ''} ${x.id === me ? 'self' : ''}"><div class="avatar">${x.bot ? '✧' : escape(x.name.slice(0, 1))}</div><b>${escape(x.name)}${x.id === me ? ' · 你' : ''}</b><small>${x.online ? `${x.count} 张牌` : '离线'}${i === state.dealer ? ' · 庄家' : ''}</small><span class="prediction"><span>已赢 ${x.won}</span><span>目标 ${x.bid ?? (x.bidSubmitted ? '已锁定' : '—')}</span></span></div>`).join('')}</div>${foresight}<div class="played-cards">${state.trick.length ? state.trick.map((x, i) => `<div class="played ${done && x.player === state.lastWinner ? 'winner' : ''}">${cardHTML(x.card)}<small>${escape(state.players[x.player].name)} ${i === 0 ? '· 首攻' : ''}${done && x.player === state.lastWinner ? ' · 获胜' : ''}</small></div>`).join('') : `<div class="table-empty"><span>✦</span><p>${state.phase === 'bid' ? '想好你的预言。' : state.phase === 'trump' ? '魔法的颜色，由你决定。' : '下一墩，新的可能。'}</p></div>`}</div><div class="table-caption">${state.completedTricks} / ${state.cardsPerRound} 墩已完成${state.reveal ? ` · 翻牌：${state.reveal.kind === 'number' ? `${SUIT_NAMES[state.reveal.suit].split(' · ')[0]} ${state.reveal.rank}` : state.reveal.kind === 'wizard' ? '巫师' : '小丑'}` : state.options.deckMode === 'mono' ? ' · 单色牌库' : ' · 牌库已用尽'}</div></section><section class="action-panel"><div class="action-title"><span class="${myTurn && !done ? 'pulse-dot' : 'gold'}">✦</span><h3>${prompt}</h3></div>${actionUI}${done && state.phase !== 'finished' ? isHost ? `<button id="next" class="primary">${roundEnd ? '开始下一轮' : '继续下一墩'} →</button>` : `<p class="muted">等待房主继续</p>` : ''}${state.phase === 'finished' && isHost ? '<button id="rematch" class="primary">再来一局 →</button>' : ''}</section><section class="hand-section"><div class="section-label">你的手牌 <span>${p?.hand?.length || 0} 张${state.phase === 'play' ? ' · 亮起的牌可以出' : ''}</span></div><div class="hand">${(p?.hand || []).slice().sort((a,b) => (SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)) || (a.rank || 0) - (b.rank || 0)).map(c => cardHTML(c, true, myTurn && state.legal.includes(c.id))).join('') || (state.foresightActive ? `<div class="concealed-hand"><strong>你的 ${p.count} 张手牌暂时保密</strong><span>先见之明 · 所有人预估完成后揭开</span></div>` : '<p class="muted">本轮手牌已出完。</p>')}</div></section></main><aside><section class="panel scoreboard"><div class="section-label">预言排行榜 <span>总分</span></div>${state.players.map((x, i) => ({ ...x, seat: i })).sort((a,b) => b.score - a.score).map((x, i) => `<div class="score-row"><span class="rank">${String(i + 1).padStart(2, '0')}</span><span>${escape(x.name)}${x.id === me ? '<small>你</small>' : ''}</span><b>${x.score}</b></div>`).join('')}${roundEnd ? `<div class="round-results"><h4>第 ${state.round} 轮得分</h4>${state.history.at(-1).result.map(r => `<div><span>${escape(state.players.find(x => x.id === r.id).name)} <small>${r.won}/${r.bid} 墩</small></span><b class="${r.delta > 0 ? 'positive' : 'negative'}">${r.delta > 0 ? '+' : ''}${r.delta}</b></div>`).join('')}</div>` : ''}</section><section class="panel journal"><div class="section-label">牌桌记事 <span>↙</span></div>${state.log.slice(-7).map(l => `<p>${escape(l)}</p>`).join('')}</section><details class="panel history"><summary>查看逐轮记分</summary><div class="history-scroll"><table><thead><tr><th>轮</th>${state.players.map(x => `<th>${escape(x.name)}</th>`).join('')}</tr></thead><tbody>${state.history.map(h => `<tr><td>${h.round}</td>${h.result.map(r => `<td title="预言 ${r.bid} / 赢 ${r.won}">${r.delta > 0 ? '+' : ''}${r.delta}<small>${r.total}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div></details></aside></div>`;
  }
  app.innerHTML = shell(`${head}${body}`);
  bindCommon();
  $('#invite')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(invitation); notify('邀请链接已复制，发给朋友吧。'); } catch { notify(`复制这个邀请链接：${invitation}`); }
  });
  $('#leave').onclick = () => {
    if (window.confirm(isHost && !practice ? '你是房主，离开会结束整个房间。确定离开？' : '确定离开当前牌桌？')) {
      leaveRoom();
    }
  };
  $('#begin-vote')?.addEventListener('click', () => send({ type: 'beginVote' }));
  $('#cancel-vote')?.addEventListener('click', () => send({ type: 'cancelVote' }));
  $('#start')?.addEventListener('click', () => send({ type: 'start' }));
  $('#vote-form')?.addEventListener('change', event => {
    if (event.target.matches('input[type="radio"]')) voteDraft[event.target.name] = ['true', 'false'].includes(event.target.value) ? event.target.value === 'true' : event.target.value;
  });
  $('#vote-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const choices = Object.fromEntries(Object.keys(state.vote.pending).map(key => [key, voteDraft[key]]));
    send({ type: 'vote', choices });
  });
  $('#addbot')?.addEventListener('click', () => {
    try { addPlayer(game, crypto.randomUUID(), '', true, true); broadcast(); } catch (error) { notify(error.message); }
  });
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    if (!isHost || game.phase !== 'lobby') return;
    const id = b.dataset.remove;
    const removed = peers.get(id);
    peers.delete(id);
    if (removed) closeWithMessage(removed, 'removed');
    game.players = game.players.filter(p => p.id !== id);
    for (const t of Object.keys(identities)) if (identities[t] === id) delete identities[t];
    broadcast();
  });
  document.querySelectorAll('[data-bid]').forEach(b => b.onclick = () => send({ type: 'bid', value: Number(b.dataset.bid) }));
  document.querySelectorAll('button[data-trump]').forEach(b => b.onclick = () => send({ type: 'trump', suit: b.dataset.trump }));
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => send({ type: 'play', card: b.dataset.card }));
  $('#next')?.addEventListener('click', () => send({ type: 'next' }));
  $('#rematch')?.addEventListener('click', () => send({ type: 'rematch' }));
}
function bindCommon() {
  const pregame = state && ['lobby', 'rules'].includes(state.phase);
  document.body.dataset.screen = !state ? 'home' : pregame ? 'lobby' : 'game';
  document.body.dataset.connection = !state ? 'home' : practice || networkReady ? 'connected' : 'reconnecting';
  if (!state) {
    const badge = document.createElement('span');
    badge.id = 'online-count';
    badge.setAttribute('role', 'status');
    badge.title = '当前网站已连接的浏览器数（含牌局中玩家），同一浏览器多个标签页合并。基于点对点连接估算，离线更新可能延迟约 90 秒，网络受限时可能少计。';
    document.querySelector('.home-presence').append(badge);
    updateOnlineCount();
  }
  const graphics = document.createElement('button');
  graphics.id = 'graphics'; graphics.className = 'text-button graphics-toggle';
  $('.top-actions').prepend(graphics);
  graphics.onclick = () => { if (tableScene) { tableScene.setLow(!tableScene.low); updateGraphicsButton(); } };
  const motion = document.createElement('button');
  motion.id = 'trump-motion'; motion.className = 'text-button';
  $('.top-actions').append(motion);
  motion.onclick = () => {
    trumpMotionPreference = String(document.body.dataset.trumpMotion !== 'on');
    localStorage.setItem('wizard-trump-motion', trumpMotionPreference);
    updateTrumpMotion();
  };
  updateTrumpMotion();
  if (state && !pregame) setupGameHUD(graphics);
  music.mount(state && !pregame ? $('#table-menu-panel') : $('.top-actions'));
  social.update(state, me, pregame ? $('.room-buttons') : $('.game-toolbar'));
  if (state && !pregame) $('#table-menu-panel')?.append($('#rename-toggle'));
  setupClearUI();
  if (state) {
    const ownPlayer = state.players.find(p => p.id === me);
    if (ownPlayer) { nickname = ownPlayer.name; automaticName = !!ownPlayer.automaticName; persistName(); }
    const table = $('.table');
    if (table) renderTrumpDisplay(table, state);
    if (!practice && !networkReady) {
      document.querySelectorAll('#start, #begin-vote, #submit-vote, #cancel-vote, #vote-form input, #addbot, [data-remove], [data-bid], [data-trump], [data-card], #next, #rematch').forEach(control => { control.disabled = true; });
    }
    // Social controls survive render(), so they must also be re-enabled after recovery.
    document.querySelectorAll('#chat-input, #chat-form button, #rename-input, #rename-form button').forEach(control => { control.disabled = !practice && !networkReady; });
  }
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
    });
  }
  $('#rules').onclick = () => { settingsOpen = false; menuOpen = false; rulesOpen = true; render(); $('#close-rules')?.focus(); };
  $('#close-rules')?.addEventListener('click', () => { rulesOpen = false; render(); $('#rules')?.focus(); });
}
function setupClearUI() {
  if (!state || ['lobby', 'rules'].includes(state.phase)) {
    const settings = document.createElement('details');
    settings.id = 'quick-settings'; settings.open = settingsOpen;
    settings.innerHTML = '<summary>设置</summary><div class="settings-content"></div>';
    const content = settings.querySelector('.settings-content');
    $('.top-actions').append(settings);
    for (const selector of ['#graphics', '#music-toggle', '#trump-motion', ...(state ? ['#rules', '#rename-toggle', '#leave'] : [])]) {
      const el = $(selector); if (el) content.append(el);
    }
    settings.ontoggle = () => { settingsOpen = settings.open; };
  } else {
    $('.action-panel').classList.toggle('your-action', state.phase === 'bid' ? state.canBid : state.players[state.turn]?.id === me && ['play', 'trump'].includes(state.phase));
    const active = $('.player.active');
    if (active) {
      const badge = document.createElement('span'); badge.className = 'turn-label';
      badge.textContent = state.phase === 'play' ? '正在出牌' : state.phase === 'bid' ? '正在预言' : '正在选色'; active.append(badge);
    }
    const journal = $('.journal');
    const details = document.createElement('details'); details.className = 'journal-details';
    details.innerHTML = '<summary>对局记录</summary>'; journal.replaceWith(details); details.append(journal);
    if (state.phase === 'play') {
      const timer = document.createElement('span'); timer.id = 'turn-countdown';
      timer.setAttribute('role', 'timer'); timer.title = '每次出牌 30 秒，超时自动出一张合法牌';
      $('.action-panel').prepend(timer);
      updateCountdown();
    }
  }
}
function updateCountdown() {
  const timer = $('#turn-countdown');
  if (!timer || !state) return;
  const seconds = Math.max(0, Math.ceil((state.turnDeadline - (Date.now() + serverClockOffset)) / 1000));
  timer.textContent = Number.isFinite(seconds) ? `${seconds} 秒` : '同步中';
  timer.classList.toggle('urgent', seconds <= 10);
  timer.setAttribute('aria-label', `当前玩家剩余出牌时间 ${Number.isFinite(seconds) ? seconds : '同步中'} 秒`);
}
function setupGameHUD(graphics) {
  if (state.phase === 'finished' && previousHUDPhase !== 'finished') scoresOpen = true;
  previousHUDPhase = state.phase;
  const toolbar = document.createElement('nav');
  toolbar.className = 'game-toolbar'; toolbar.setAttribute('aria-label', '对局工具');
  toolbar.innerHTML = '<button id="table-scores" aria-controls="table-score-panel">比分</button><button id="table-menu" aria-controls="table-menu-panel">设置</button>';
  $('.page').append(toolbar);
  const menu = document.createElement('section');
  menu.id = 'table-menu-panel'; menu.className = 'table-menu-panel';
  const title = document.createElement('p');
  title.textContent = practice ? '离线练习' : `房间 ${room}`; menu.append(title);
  const selectedRules = document.createElement('p');
  selectedRules.className = 'current-rules'; selectedRules.textContent = ruleSummary(state.options); menu.append(selectedRules);
  for (const el of [$('#rules'), graphics, $('#trump-motion'), $('#invite'), $('#leave')]) if (el) menu.append(el);
  $('.page').append(menu);
  const scores = $('.game-layout aside'); scores.id = 'table-score-panel';
  const close = document.createElement('button');
  close.className = 'close-scores'; close.textContent = '关闭计分 ×'; scores.prepend(close);
  const update = () => {
    menu.hidden = !menuOpen; scores.hidden = !scoresOpen;
    $('#table-menu').setAttribute('aria-expanded', String(menuOpen));
    $('#table-scores').setAttribute('aria-expanded', String(scoresOpen));
  };
  $('#table-menu').onclick = () => { menuOpen = !menuOpen; scoresOpen = false; update(); };
  $('#table-scores').onclick = () => { scoresOpen = !scoresOpen; menuOpen = false; update(); };
  close.onclick = () => { scoresOpen = false; update(); $('#table-scores').focus(); };
  update();
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { settingsOpen = false; if ($('#quick-settings')) $('#quick-settings').open = false; }
  if (event.key === 'Escape' && (scoresOpen || menuOpen)) {
    scoresOpen = false; menuOpen = false;
    $('#table-menu-panel')?.setAttribute('hidden', '');
    $('#table-score-panel')?.setAttribute('hidden', '');
    $('#table-menu')?.setAttribute('aria-expanded', 'false');
    $('#table-scores')?.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && rulesOpen) { rulesOpen = false; render(); } });
function saveName() {
  try {
    if (!nickname.trim()) { nickname = uniqueRandomName(); automaticName = true; }
    nickname = validateName(nickname); persistName(); return true;
  } catch (error) { notify(error.message); return false; }
}
function persistRoom() {
  if (!room || !me) return;
  const saved = isHost
    ? { role: practice ? 'practice' : 'host', room, me, game, identities }
    : { role: 'guest', room, me, state };
  if (!saveRoomSession(sessionStorage, saved)) notify('浏览器存储不可用，刷新后可能无法恢复牌局。');
}
function stopRoomTransport() {
  roomEpoch++;
  const previous = transport;
  transport = null;
  peers.clear();
  clearTimeout(botTimer); clearTimeout(turnTimer);
  previous?.stop();
}
function closeWithMessage(conn, type) {
  const deadline = setTimeout(() => conn.close(), 3000);
  conn.on('close', () => clearTimeout(deadline));
  try {
    if (conn.open) { conn.send({ type }); conn.close({ flush: true }); }
    else conn.close();
  } catch { conn.close(); }
}
function leaveRoom(message = '', announce = true) {
  const previous = transport;
  // Let the explicit close message leave the data channels before closing them.
  const closing = announce && isHost && !practice;
  if (closing) for (const conn of peers.values()) closeWithMessage(conn, 'room-closed');
  roomEpoch++; transport = null; peers.clear(); clearTimeout(botTimer); clearTimeout(turnTimer);
  if (closing) setTimeout(() => previous?.stop(), 3000);
  else previous?.stop();
  clearRoomSession(sessionStorage);
  game = state = undefined; room = me = ''; identities = {};
  isHost = practice = networkReady = busy = false;
  scoresOpen = menuOpen = rulesOpen = false; previousHUDPhase = '';
  history.replaceState(null, '', location.pathname);
  notify(message); render();
}
function broadcast(socialOnly = false) {
  serverClockOffset = 0;
  state = viewFor(game, me);
  persistRoom();
  if (!practice) {
    for (const [id, conn] of peers) if (conn.open) {
      try { conn.send({ type: 'state', state: viewFor(game, id), serverTime: Date.now() }); } catch { conn.close(); }
    }
  }
  render();
  if (socialOnly) return;
  clearTimeout(turnTimer);
  if (game.phase === 'play' && Number.isFinite(game.turnDeadline)) {
    turnTimer = setTimeout(() => {
      try { act(game, me, { type: 'timeout' }); broadcast(); } catch (e) { notify(e.message); }
    }, Math.max(0, game.turnDeadline - Date.now()) + 30);
  }
  clearTimeout(botTimer);
  const bot = game.players.find(p => p.bot && p.online && botAction(game, p.id));
  if ((practice || networkReady) && bot) botTimer = setTimeout(() => {
    try { const action = botAction(game, bot.id); if (action) { act(game, bot.id, action); broadcast(); } } catch (e) { notify(e.message); }
  }, 750);
}
function send(action) {
  if (!practice && !networkReady) { notify('正在恢复连接，请稍候再操作。'); return false; }
  if (isHost) {
    try { act(game, me, action); notify(''); broadcast(['chat', 'rename'].includes(action.type)); return true; } catch (e) { notify(e.message); }
  } else if (transport?.send({ type: 'action', action })) return true;
  else notify('连接已中断，正在自动重连，请稍候再操作。');
  return false;
}
function startPractice() {
  if (!saveName()) return;
  stopRoomTransport(); clearRoomSession(sessionStorage); identities = {};
  practice = true; isHost = true; me = crypto.randomUUID(); room = '离线练习';
  game = createGame(); addPlayer(game, me, nickname, false, automaticName);
  addPlayer(game, crypto.randomUUID(), '', true, true); addPlayer(game, crypto.randomUUID(), '', true, true);
  networkReady = true; busy = false; game.options.short = true;
  notify(''); broadcast();
}
function networkOptions() {
  const turn = import.meta.env.VITE_TURN_URL;
  return turn ? { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: turn, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] } } : {};
}
function launch(host, restored = null) {
  if (!saveName()) return;
  const entered = restored?.room || $('#room-input')?.value.trim().toUpperCase();
  if (!host && !/^[A-Z2-9]{8}$/.test(entered)) return notify('请输入有效的 8 位房间码。');
  if (busy) return;
  stopRoomTransport();
  const epoch = roomEpoch;
  const current = () => roomEpoch === epoch;
  busy = true; networkReady = false;
  isHost = host; practice = false;
  state = undefined;
  if (host) {
    if (restored) {
      ({ game, identities, room, me } = restored);
      normalizeGame(game);
      if (game.phase === 'play' && !Number.isFinite(game.turnDeadline)) game.turnDeadline = Date.now() + TURN_MS;
      game.players.forEach(p => { p.online = p.id === me || p.bot; });
    } else {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      room = Array.from(crypto.getRandomValues(new Uint8Array(8)), n => chars[n % chars.length]).join('');
      me = crypto.randomUUID(); game = createGame(); identities = { [token]: me }; addPlayer(game, me, nickname, false, automaticName);
    }
    state = viewFor(game, me);
  } else {
    room = entered; me = restored?.me || ''; game = undefined; identities = {};
    state = restored?.state;
  }
  if (host) persistRoom();
  notify(restored ? '正在恢复原来的房间和牌局…' : host ? '正在创建房间…' : '正在连接好友房间…');
  render();
  transport = createRoomTransport({
    Peer, host, room, options: networkOptions(),
    onStatus(status) {
      if (!current()) return;
      networkReady = status === 'connected'; busy = !networkReady;
      if (!networkReady && host) {
        peers.clear();
        game.players.forEach(player => { player.online = player.id === me || player.bot; });
      }
      const message = networkReady
        ? (restored || state?.phase !== 'lobby' ? '已回到原来的房间。' : host ? '房间已准备好。邀请好友，或添加机器人。' : '已加入房间。')
        : (host ? '正在恢复房间连接，牌局进度已保留…' : '正在连接房主，房主恢复后会自动回到原牌局…');
      notify(message);
      if (host) broadcast(); else render();
    },
    onOpen() { if (current()) transport.send({ type: 'join', token, name: nickname, automaticName }); },
    onData(msg) {
      if (!current()) return;
      if (msg?.type === 'welcome') { me = msg.id; persistRoom(); }
      if (msg?.type === 'state' && me && msg.state?.players?.some(player => player.id === me)) {
        serverClockOffset = Number.isFinite(msg.serverTime) ? msg.serverTime - Date.now() : 0;
        state = msg.state;
        persistRoom(); transport.ready(); render();
      }
      if (msg?.type === 'error') {
        if (!networkReady) leaveRoom(msg.message, false);
        else notify(msg.message);
      }
      if (msg?.type === 'removed') leaveRoom('你已被移出房间。', false);
      if (msg?.type === 'room-closed') leaveRoom('房主已关闭房间。', false);
    },
    onConnection(conn, isCurrent) {
      const active = () => current() && isCurrent();
      let id = null, count = 0, windowStart = Date.now();
      const joinTimeout = setTimeout(() => { if (!id) conn.close(); }, 10000);
      conn.on('data', msg => {
        if (!active()) return;
        if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now(); }
        if (++count > 30) return;
        try {
          if (!msg || typeof msg !== 'object') throw new Error('无效消息。');
          if (msg.type === 'join' && !id) {
            if (typeof msg.token !== 'string' || !/^[a-f0-9-]{36}$/.test(msg.token)) throw new Error('无效身份，请刷新后重试。');
            if (identities[msg.token]) {
              id = identities[msg.token];
              if (id === me) { id = null; throw new Error('房主身份不能作为访客加入。'); }
            } else {
              const newId = crypto.randomUUID(); addPlayer(game, newId, msg.name, false, msg.automaticName === true);
              id = newId; identities[msg.token] = id;
            }
            const old = peers.get(id);
            clearTimeout(joinTimeout); peers.set(id, conn); game.players.find(p => p.id === id).online = true;
            if (old && old !== conn) old.close();
            conn.send({ type: 'welcome', id }); broadcast();
          } else if (msg.type === 'action' && id && peers.get(id) === conn) {
            act(game, id, msg.action); broadcast(['chat', 'rename'].includes(msg.action.type));
          }
        } catch (e) { conn.send({ type: 'error', message: e.message }); }
      });
      conn.on('close', () => {
        clearTimeout(joinTimeout);
        if (active() && id && peers.get(id) === conn) { peers.delete(id); const p = game.players.find(p => p.id === id); if (p) p.online = false; broadcast(); }
      });
      conn.on('error', () => conn.close());
    },
  });
}
const social = new RoomSocial(send);
const music = new BackgroundMusic();
setInterval(updateCountdown, 250);
render();
let presence;
function startPresence() {
  let visitor;
  try {
    visitor = localStorage.getItem('wizard-presence-id');
    if (!visitor) {
      visitor = crypto.randomUUID();
      localStorage.setItem('wizard-presence-id', visitor);
    }
  } catch { visitor = crypto.randomUUID(); }
  presence = createPresence({
    Peer, room: presenceRoom(location), visitor, options: networkOptions(),
    onChange: value => { onlinePresence = value; updateOnlineCount(); },
  });
}
startPresence();
function restoreRoom(saved) {
  if (!saved) return;
  busy = false;
  if (saved.role === 'practice') {
    stopRoomTransport();
    ({ game, identities, room, me } = saved);
    normalizeGame(game);
    if (game.phase === 'play' && !Number.isFinite(game.turnDeadline)) game.turnDeadline = Date.now() + TURN_MS;
    isHost = practice = networkReady = true;
    notify('已恢复原来的练习牌局。'); broadcast();
  } else launch(saved.role === 'host', saved);
}
window.addEventListener('pagehide', () => {
  persistRoom();
  stopRoomTransport(); networkReady = false; busy = false;
  presence?.stop();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { startPresence(); restoreRoom(readRoomSession(sessionStorage)); }
});
window.addEventListener('online', () => transport?.wake());
restoreRoom(savedSession);
