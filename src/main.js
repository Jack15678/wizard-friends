import { createGame, addPlayer, viewFor, botAction, normalizeGame, TURN_MS, SUITS, SUIT_NAMES, winner, leadSuit } from './game.js';
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
import { createPresence } from './presence.js';
import { createRoomTransport } from './room-transport.js';
import { readRoomSession, saveRoomSession, clearRoomSession } from './room-session.js';
import { RoomDirectory } from './room-directory.js';
import { applyPublicAction } from './spectator-events.js';
import './spectator.css';
import './table-ui.css';
import { captureHand, HandMotion } from './hand-motion.js';
import { seatPosition, compactPlayedPosition, relativeSeat, targetStatus, playBlockedReason, sortCards, isSwipe } from './hand-model.js';
import { readRoomRecoveries, saveRoomRecovery, removeRoomRecovery } from './room-recovery.js';
import { PRACTICE_SAVE_KEY, PRACTICE_KEEP_MS, readPractice, savePractice } from './practice-save.js';

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
  if (tableScene) { tableScene.paused = !!state?.lifecycle?.paused; tableScene.viewer = me; tableScene.attach(mount, state); }
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
let transport, game, state, isHost = false, practice = false, room = '', me = '', identities = {};
let spectating = false;
let botTimer, status = '', busy = false, rulesOpen = false, networkReady = false;
let voteDraft = {}, voteDraftRound = null;
let roomEpoch = 0;
let scoresOpen = false, menuOpen = false, previousHUDPhase = '';
let settingsOpen = false, turnTimer, serverClockOffset = 0;
let joinOpen = new URLSearchParams(location.search).has('room');
let joinDraft = null;
let pendingPlay = null, noticeTimer;
const handMotion = new HandMotion(showHoveredCard);
let selectedCard = null, handExpanded = false, handCollapsed = false, handSort = 'suit', handScroll = 0, gridScroll = 0, selectionContext = '';
let seenEventSeq = null, lastTurnCue = '', turnSound = localStorage.getItem('wizard-turn-sound') !== 'false';
let practicePaused = false, practiceRemaining = null, animationBatch = [];
let practiceSaved = readPractice(localStorage);

const tokenKey = 'wizard-player-token';
let token = sessionStorage.getItem(tokenKey);
if (!token) { token = crypto.randomUUID(); sessionStorage.setItem(tokenKey, token); }
let nickname = sessionStorage.getItem('wizard-name') || uniqueRandomName();
let automaticName = sessionStorage.getItem('wizard-name-automatic') !== 'false';
persistName();
const roomFromURL = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
const watchFromURL = new URLSearchParams(location.search).get('watch') === '1';
const savedSession = readRoomSession(sessionStorage, roomFromURL);
const storedRoom = savedSession?.room || '';
function notify(message) {
  clearTimeout(noticeTimer);
  status = message; const el = $('#notice'); if (el) el.textContent = message;
  // Recoverability is shown by the permanent room controls; this acknowledgement
  // must not sit over a seat for the rest of a round.
  if (message && /^(已恢复|已回到|已加入|房间已准备)/.test(message)) noticeTimer=setTimeout(()=>{
    if(status===message) { status='';const current=$('#notice');if(current)current.textContent=''; }
  },3000);
}
function showHoveredCard(id) {
  const card=state?.players.find(p=>p.id===me)?.hand?.find(c=>c.id===id);
  const preview=$('.hover-preview'),selected=$('.selected-preview');
  if(!preview)return;
  preview.hidden=!card || id===selectedCard;
  if(selected)selected.hidden=!!card && id!==selectedCard;
  if(card && id!==selectedCard)preview.innerHTML=`${cardHTML(card)}<span>查看 ${escape(cardLabel(card))}</span><small>点击选中，再确认出牌</small>`;
}
function pendingContext(value=state) {return value ? `${value.round}:${value.completedTricks}:${value.phase}:${value.turn}:${!!value.lifecycle?.paused}:${networkReady}` : '';}

function persistName() {
  sessionStorage.setItem('wizard-name', nickname);
  sessionStorage.setItem('wizard-name-automatic', String(automaticName));
}
function cardLabel(c) {
  return c.kind === 'wizard' ? '巫师 W' : c.kind === 'jester' ? '小丑 J' : `${SUIT_NAMES[c.suit].split(' · ')[0]} ${c.rank}`;
}
function cardHTML(c, inspectable = false, legal = false, selected = false) {
  const special = c.kind !== 'number';
  const label = c.kind === 'wizard' ? '巫师' : c.kind === 'jester' ? '小丑' : SUIT_NAMES[c.suit].split(' · ')[1];
  const value = special ? (c.kind === 'wizard' ? 'W' : 'J') : c.rank;
  return `<button class="card ${c.suit || c.kind} ${legal ? 'playable' : ''} ${selected ? 'selected' : ''}" style="background-image:url('${cardImage(c)}')" ${inspectable ? `data-card="${escape(c.id)}" aria-pressed="${selected}"` : 'disabled tabindex="-1"'} aria-label="${escape(cardLabel(c))}${legal ? '，合法牌' : ''}${selected ? '，已选中' : ''}" title="${label} ${value}"><span class="corner">${value}<small>${symbols[c.suit || c.kind]}</small></span><span class="sigil">${symbols[c.suit || c.kind]}</span><span class="card-name">${label}</span><span class="corner bottom">${value}</span>${inspectable && legal ? '<span class="legal-tag">可出</span>' : ''}</button>`;
}
function ownStatusHTML(p, settled) {
  if (!p) return '';
  const progress = targetStatus(p, settled);
  const compactAction=state.phase==='play' && matchMedia('(max-width:850px)').matches ? `<div class="own-action"><span><b>${!practice && !networkReady ? '连接恢复中' : state.lifecycle?.paused ? '牌局已暂停' : state.players[state.turn]?.id===me ? '轮到你出牌' : `等待 ${escape(state.players[state.turn]?.name)} 出牌`}</b><small>${leadSuit(state.trick) ? `跟${SUIT_NAMES[leadSuit(state.trick)].split(' · ')[0]}色` : '本墩自由出牌'}</small></span><span id="turn-countdown" role="timer"></span></div>` : '';
  return `<section class="own-status ${state.players[state.turn]?.id === me ? 'active' : ''}" aria-label="你的个人目标"><div class="avatar">${escape(p.name.slice(0,1))}</div><strong>${escape(p.name)}<small>你${isHost ? ' · 房主' : ''}</small></strong><div class="own-metrics"><span>目标<b>${p.bid ?? '—'}</b></span><span>已赢<b>${p.won}</b></span><span class="goal-${progress.state}">${progress.text}<b>${progress.value}</b></span><span>累计<b>${p.score}<small>分</small></b></span></div>${compactAction}</section>`;
}
function handHTML(p, myTurn) {
  const cards = sortCards(p?.hand || [], handSort), selected = cards.find(c => c.id === selectedCard);
  const reason = pendingPlay ? '正在提交，等待房间确认' : selected ? (!networkReady && !practice ? '连接恢复中，重新连接后再选择' : playBlockedReason(state, me, selected)) : '';
  return `<div class="hover-preview" hidden aria-live="polite"></div>${selected ? `<div class="selected-preview" aria-live="polite">${cardHTML(selected)}<span>已选 ${escape(cardLabel(selected))}</span>${reason ? `<small>${escape(reason)}</small>` : ''}</div>` : ''}<section class="hand-section ${handExpanded ? 'expanded' : ''} ${handCollapsed ? 'collapsed' : ''}" aria-label="你的手牌"><div class="hand-heading"><b>手牌 · ${p?.count ?? cards.length} 张</b><span>${handExpanded ? '点击查看 · 确认出牌' : '左右滑动浏览'}</span><button id="hand-collapse" aria-expanded="${!handCollapsed}">${handCollapsed ? '展开手牌' : '收起手牌'}</button><button id="hand-sort" aria-label="切换手牌排序">${handSort === 'suit' ? '花色排序' : '点数排序'}</button><button id="hand-expand" aria-expanded="${handExpanded}">${handExpanded ? '收起 ⌄' : '展开 ⌃'}</button></div><div class="hand ${handExpanded ? 'hand-grid' : 'hand-strip'}" tabindex="0">${cards.map(c => cardHTML(c, true, myTurn && state.legal.includes(c.id), c.id === selectedCard)).join('') || (state.foresightActive ? `<div class="concealed-hand"><strong>你的 ${p?.count || 0} 张手牌暂时保密</strong><span>先见之明 · 全员预估后揭开</span></div>` : '<p class="muted">本轮手牌已出完。</p>')}</div></section><div class="play-confirm" data-submitting="${!!pendingPlay}" aria-busy="${!!pendingPlay}"><span class="selection-name">${selected ? `已选 ${escape(cardLabel(selected))}` : '点击选牌 · 确认后出牌'}</span><button id="cancel-card" ${!selected || pendingPlay ? 'disabled' : ''}>取消</button><button id="confirm-play" class="primary" ${!selected || reason ? 'disabled' : ''}>${pendingPlay ? '正在提交…' : selected && !reason ? '确认出牌' : selected ? '当前不可出牌' : '请先选牌'}</button></div>`;
}
function lifecycleHTML() {
  const life = state.lifecycle || {}, vote = life.continuationVote;
  const deadline = life.retentionDeadline ? new Date(life.retentionDeadline).toLocaleString('zh-CN', {hour12:false}) : null;
  return `${life.paused || life.hostOffline || life.closeAfterRound ? `<div class="lifecycle-banner" role="status">${life.paused ? `已暂停 · ${escape(life.pauseReason || '房主主动暂停')}` : life.hostOffline ? '房主离线 · 牌局由房间服务保留' : ''}${life.closeAfterRound ? ' · 仅完成当前轮，结果确认后关闭' : ''}<small>${deadline ? `保留截止 ${deadline}` : practice ? '离开后原浏览器保留 10 分钟' : '房主在线时不因闲置过期'}</small></div>` : ''}${vote ? `<div class="continuation-panel" role="dialog" aria-modal="true" aria-label="到期续赛投票"><h2>房间保留时间已到</h2><p>全体在线真人同意后，仅完成当前轮；任一拒绝或 60 秒未全员确认即关闭。</p><p>${vote.accepted.length} / ${vote.voters.length} 已同意 · <span id="continuation-countdown"></span></p>${vote.voters.includes(me) ? `<button id="continue-no">拒绝并关闭</button><button id="continue-yes" class="primary" ${vote.accepted.includes(me) ? 'disabled' : ''}>${vote.accepted.includes(me) ? '已同意，等待其他人' : '同意完成本轮'}</button>` : '<p>等待投票结果</p>'}</div>` : ''}`;
}

function shell(body) {
  if (!state) return `<div class="page">${body}<header class="topbar home-tools"><div class="top-actions"><button class="text-button" id="rules">游戏规则</button></div></header></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
  return `<div class="page"><header class="topbar"><a class="brand" href="${location.pathname}"><span class="brand-icon">✦</span><span>巫师牌<small>WIZARD / FRIENDS TABLE</small></span></a><div class="top-actions"><span class="tag">好友之间，预言成真</span><button class="text-button" id="rules">玩法说明</button></div></header>${body}<footer><span>一副牌，无数种预言。</span><span>非官方好友同乐版 · 牌面原创绘制</span></footer></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
}
function rulesHTML() {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="rule-title"><button class="close" id="close-rules" aria-label="关闭规则">×</button><div class="eyebrow">THE ART OF PREDICTION</div><h2 id="rule-title">先预估，再出牌。</h2>
    <p>3–6 人，共 60 张牌：四种花色各 1–13，以及 4 张巫师、4 张小丑。标准牌库第 N 轮每人发 N 张牌。</p>
    <ol><li><b>确定主牌。</b>翻开的数字牌花色是本轮主牌；翻到巫师由庄家选色，小丑或牌库用尽则无主牌。</li><li><b>预估墩数。</b>公开预估从庄家左手开始。每人出一张牌，组成一墩。</li><li><b>依次出牌。</b>有首攻花色必须跟色；巫师和小丑随时能出。巫师起手可任意出牌，小丑起手看第一张非小丑牌。</li><li><b>判定赢家。</b>最先出的巫师 ＞ 最大主牌 ＞ 首攻花色最大牌。全是小丑则第一张赢。赢家下一墩先出。</li><li><b>计分。</b>猜中得 20 + 10 × 赢墩数；猜错每差一墩扣 10 分。最高总分胜，同分共享胜利。</li></ol>
    <h3>每轮发牌前，全员投票</h3><p>牌库和局长在开局确定，整局固定；预估方式、加减预估和先见之明每轮重新选择。真人按类别投票，机器人不投票；最高票选项获选，平票项重投。房主在结果确定后发本轮的牌。</p>
    <ul><li><b>加减预估：</b>最后一人的预估不能使总和等于本轮墩数，仅搭配公开预估，可同时开启先见之明。</li><li><b>隐藏预估：</b>独立提交，全部提交后同时公开。</li><li><b>秘密数字：</b>独立提交，只能看自己的预估，本轮打完才公开所有人的数字。</li><li><b>先见之明：</b>开启的当轮预估时隐藏自己的整手牌，展示其他人的手牌。全部预估完恢复正常；单色模式也适用于当轮全部手牌。</li><li><b>单色牌库（3–4 人）：</b>每人独占一个随机花色 1–13，加 1 张巫师和 1 张小丑。第一轮发 4 张，逐轮增加，12 轮结束。每轮将所有牌归还原牌库重新洗牌；无主牌，数字跨花色比较，最大数字胜，同数字先出者较强。巫师、小丑及计分沿用基本规则。</li></ul>
    <p>标准完整局：3/4/5/6 人分别 20/15/12/10 轮。两种牌库均可选本站的 5 轮快速局，单色快速局每轮发 4–8 张。</p>
    <p class="muted">真人房由房间服务校验、保存和推进。普通房主离线保留 30 分钟；主动暂停的真人房最多保留 4 小时。离线练习在原浏览器离开后保留 10 分钟。</p><a href="https://blog.amigo-spiele.de/content/ap/rule/06900-GB-AmigoRule.pdf" target="_blank" rel="noopener">查看 AMIGO 官方基本规则 ↗</a></section></div>`;
}
function render() {
  const previousHand=captureHand($('.hand'));
  if (!state) {
    const returnSession = readRoomSession(sessionStorage,roomFromURL);
    const recoveryHandles=readRoomRecoveries(localStorage,roomFromURL);
    const returnRooms=returnSession && returnSession.role !== 'practice' ? [{...returnSession,token},...recoveryHandles.filter(r=>r.room!==returnSession.room || r.token!==token)] : recoveryHandles;
    app.innerHTML = shell(`<main class="home-screen">
      <section class="hero home-scene" aria-label="烛光牌桌"><div class="hero-cards">${cardHTML({ kind: 'number', suit: 'blue', rank: 13 })}${cardHTML({ kind: 'wizard' })}${cardHTML({ kind: 'number', suit: 'red', rank: 7 })}</div></section>
      <section class="home-menu" aria-label="主菜单">
        <div class="home-title"><span class="title-ornament" aria-hidden="true">✦</span><h1>巫师牌</h1><span class="home-wordmark">W I Z A R D</span></div>
        <nav class="menu-options" aria-label="开始游戏">
          ${returnRooms.map((r,i)=>`<button ${i===0 ? 'id="resume-room"' : ''} data-return-room="${i}" class="menu-choice">返回 ${escape(r.room)} · ${r.role==='host' ? '房主' : r.role==='spectator' ? '观战' : '玩家'}</button>`).join('')}<button id="create" class="menu-choice menu-primary" ${busy ? 'disabled' : ''}>${busy ? '正在连接…' : '创建房间'}<span aria-hidden="true">↗</span></button>
          <button id="join-menu" class="menu-choice" aria-expanded="${joinOpen}" aria-controls="join-form" ${busy ? 'disabled' : ''}>加入房间<span aria-hidden="true">＋</span></button>
          <form id="join-form" class="menu-join" ${joinOpen ? '' : 'hidden'}><label class="sr-only" for="room-input">房间码</label><input id="room-input" placeholder="输入房间码" maxlength="24" autocomplete="off" value="${escape(joinDraft ?? (roomFromURL || storedRoom))}"><button id="join" type="submit" ${busy ? 'disabled' : ''}>加入</button></form>
          ${practiceSaved ? '<button id="resume-practice" class="menu-choice">恢复练习<span>↗</span></button>' : ''}<button id="practice" class="menu-choice" ${busy ? 'disabled' : ''}>单人练习<span aria-hidden="true">↗</span></button>
          ${busy ? '<button id="cancel-connect" class="text-button">取消连接</button>' : ''}
        </nav>
        <div class="menu-identity"><label for="nickname">昵称</label><input id="nickname" maxlength="16" placeholder="旅人" autocomplete="nickname" value="${escape(nickname)}"></div>
        <div class="home-presence"></div>
      </section><aside class="home-room-list" aria-label="正在进行的房间"></aside></main>`);
    bindCommon();handMotion.attach(null,previousHand,null);
    $('#create').onclick = () => launch(true);
    document.querySelectorAll('[data-return-room]').forEach(button=>button.addEventListener('click',()=>{
      const recovery=returnRooms[Number(button.dataset.returnRoom)];if(!recovery)return;
      token=recovery.token;sessionStorage.setItem(tokenKey,token);restoreRoom(recovery);
    }));
    $('#join-form').onsubmit = e => { e.preventDefault(); launch(false); };
    $('#room-input').oninput = e => { joinDraft = e.target.value; };
    $('#join-menu').onclick = () => {
      joinOpen = !joinOpen;
      $('#join-form').hidden = !joinOpen;
      $('#join-menu').setAttribute('aria-expanded', String(joinOpen));
      if (joinOpen) $('#room-input').focus();
    };
    $('#practice').onclick = startPractice;
    $('#resume-practice')?.addEventListener('click', () => restoreRoom(readPractice(localStorage)));
    $('#cancel-connect')?.addEventListener('click', () => leaveRoom());
    $('#nickname').oninput = e => { nickname = e.target.value; automaticName = false; persistName(); };
    return;
  }
  const p = state.players.find(p => p.id === me);
  const selfIndex = state.players.findIndex(p => p.id === me);
  const context = `${state.round}:${state.completedTricks}:${state.phase}:${state.turn}:${!!state.lifecycle?.paused}:${networkReady}`;
  if (context !== selectionContext) { selectedCard = null; pendingPlay=null; selectionContext = context; }
  if (pendingPlay && (!p?.hand?.some(c=>c.id===pendingPlay.id) || pendingPlay.context!==pendingContext())) pendingPlay=null;
  if (!p?.hand?.some(c => c.id === selectedCard)) selectedCard = null;
  const oldHand = $('.hand'); if (oldHand && oldHand.offsetParent!==null) { if (oldHand.classList.contains('hand-grid')) gridScroll = oldHand.scrollTop; else handScroll = oldHand.scrollLeft; }
  const myTurn = !spectating && state.players[state.turn]?.id === me;
  const hostName = state.players[0]?.name;
  const invitation = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}${spectating ? '&watch=1' : ''}`;
  const head = `<div class="room-heading"><div class="room-identity"><span>${practice ? '练习牌桌' : spectating ? '观战房间' : '房间'}</span><span class="room-code">${practice ? '' : escape(room)}</span><span class="seat-count">${state.players.length} / 6${!practice ? ` · ${state.spectatorCount || 0} 人观战` : ''}</span></div><div class="room-buttons">${!practice ? `<button id="invite">${spectating ? '分享观战' : '邀请好友'}</button>` : ''}<button id="leave" class="text-button">${spectating ? '退出观战' : '离开'}</button></div></div>`;
  let body;
  if (state.phase !== 'rules') { voteDraft = {}; voteDraftRound = null; }
  if (state.phase === 'lobby') {
    const startHint = state.players.length < 3 ? `还差 ${3 - state.players.length} 人` : state.players.some(p => !p.online) ? '等待玩家重连' : '';
    body = `<main class="lobby-table">
      <div class="hero lobby-scene" aria-hidden="true"><div class="lobby-felt"></div></div>
      <div class="seats" aria-label="房间座位">${state.players.map((p, i) => `<div class="seat ${p.id === me ? 'my-seat' : ''} ${!p.online ? 'offline' : ''}"><div class="avatar">${p.bot ? '✧' : escape(p.name.slice(0, 1))}</div><div class="seat-name"><b>${escape(p.name)}</b><small>${i === 0 ? '房主' : p.bot ? '机器人' : p.online ? '已入座' : '离线'}</small></div>${isHost && i > 0 ? `<button data-remove="${escape(p.id)}" class="text-button" aria-label="移除 ${escape(p.name)}" title="移除玩家">×</button>` : ''}</div>`).join('')}${Array.from({ length: 6 - state.players.length }, () => '<div class="seat empty"><div class="avatar">＋</div><span>空位</span></div>').join('')}</div>
      <div class="lobby-controls">
        <div class="lobby-options">${isHost && state.players.length < 6 ? '<select id="bot-difficulty" aria-label="机器人难度"><option value="smart">策略陪练</option><option value="simple">简单陪练</option></select><button id="addbot" class="text-button">＋ 机器人</button>' : ''}
          <span class="start-hint">开局确定牌库和局长，每轮投票选择变体</span>
        </div>
        <div class="lobby-start">${isHost ? `${startHint ? `<span class="start-hint">${startHint}</span>` : ''}<button id="begin-vote" class="primary" ${startHint ? 'disabled' : ''}>选择开局规则 →</button>` : `<span class="start-hint">等待 ${escape(hostName)} 发起投票</span>`}</div>
      </div>
    </main>`;
  } else if (state.phase === 'rules' && spectating) {
    body = `<main class="rules-vote"><h2>玩家正在选择第 ${state.round + 1} 轮规则</h2><p class="muted">投票选项保持保密。结果确定后将继续同步牌局。</p>${state.round ? `<p class="current-rules">上轮规则：${escape(ruleSummary(state.options))}</p>` : ''}</main>`;
  } else if (state.phase === 'rules') {
    const voteKey = `${state.vote.targetRound ?? state.round + 1}:${state.vote.round}`;
    if (voteDraftRound !== voteKey) {
      voteDraftRound = voteKey;
      voteDraft = { ...state.options, ...(practice ? { short: true } : {}), ...state.vote.ownChoices };
      for (const [key, values] of Object.entries(state.vote.pending)) if (!values.includes(voteDraft[key])) voteDraft[key] = values[0];
    }
    body = ruleVoteHTML(state, me, isHost, voteDraft);
  } else {
    const done = ['trickEnd', 'roundEnd', 'finished'].includes(state.phase);
    const roundEnd = ['roundEnd', 'finished'].includes(state.phase);
    const highScore = Math.max(...state.players.map(p => p.score));
    const turnName = escape(state.players[state.turn]?.name);
    const prompt = state.phase === 'finished' ? `${state.players.filter(p => p.score === highScore).map(p => escape(p.name)).join('、')} 赢得本局` : done ? `${escape(state.players[state.lastWinner]?.name)} 赢下这一墩` : state.phase === 'bid' ? (state.canBid ? (state.foresightActive ? '看别人的牌，预估自己能赢几墩？' : '你预言自己能赢几墩？') : p?.bidSubmitted ? '你的预估已提交，等待其他玩家。' : `等待 ${turnName} 预估…`) : myTurn ? ({ trump: '翻到了巫师，请选择本轮王牌', bid: '你预言自己能赢几墩？', play: '轮到你了，点击金边手牌出牌' }[state.phase]) : `等待 ${turnName} ${state.phase === 'bid' ? '预言' : state.phase === 'trump' ? '选择王牌' : '出牌'}…`;
    const actionUI = state.canBid ? `<div class="bid-options">${state.bids.map(n => `<button class="bid" data-bid="${n}">${n}</button>`).join('')}</div>` : myTurn && state.phase === 'trump' ? `<div class="trump-options">${SUITS.map(s => `<button data-trump="${s}" class="suit-chip ${s}">${symbols[s]} ${SUIT_NAMES[s]}</button>`).join('')}</div>` : '';
    const foresight = state.foresightActive ? `<section class="foresight-hands" aria-label="先见之明：其他玩家手牌">${state.players.filter(x => x.id !== me).map(x => `<div class="foresight-player"><p>${escape(x.name)}</p><div class="foresight-cards">${(x.hand || []).map(c => cardHTML(c)).join('')}</div></div>`).join('')}</section>` : '';
    const playedRadius=matchMedia('(max-width:380px)').matches ? .21 : matchMedia('(max-width:850px)').matches ? .27 : .53;
    const currentWinner = state.trick.length ? winner(state.trick, state.trump, state.options.deckMode) : null;
    const lead = leadSuit(state.trick);
    const ownResult = state.history.at(-1)?.round === state.round ? state.history.at(-1).result.find(r => r.id === me) : null;
    const roundResult = roundEnd && ownResult ? `<section class="personal-result"><b>第 ${state.round} 轮 · ${ownResult.bid === ownResult.won ? '预言成功' : '本轮结算'}</b><span>目标 ${ownResult.bid} · 实际 ${ownResult.won}</span><strong>${ownResult.delta >= 0 ? '+' : ''}${ownResult.delta} 分</strong><span>累计 ${ownResult.total - ownResult.delta} → ${ownResult.total}</span></section>` : '';
    body = `<div class="game-layout"><main><div class="roundbar"><span>第 <b>${state.round}</b> / ${state.maxRounds} 轮</span><span>第 ${Math.min(state.cardsPerRound, done ? state.completedTricks : state.completedTricks + 1)} 墩 · 余 ${Math.max(0, state.cardsPerRound - state.completedTricks)} 墩</span></div><section class="table"><div class="table-ring"></div><div class="opponents" data-count="${state.players.length}" aria-label="围桌席位">${state.players.filter(x => x.id !== me).map(x => {
      const i = state.players.findIndex(y => y.id === x.id), pos = seatPosition(i, selfIndex, state.players.length);
      return `<div class="player ${!done && !(state.phase === 'bid' && state.options.predictionMode !== 'public') && state.turn === i ? 'active' : ''}" data-seat="${pos.seat}" data-player="${escape(x.id)}" style="--seat-x:${pos.x}%;--seat-y:${pos.y}%"><div class="avatar">${x.bot ? '✧' : escape(x.name.slice(0, 1))}</div><b>${escape(x.name)}</b><small>${x.count} 张 · ${x.online ? x.bot ? '机器人' : '在线' : '离线'}${i === state.dealer ? ' · 庄家' : ''}</small><span class="prediction"><span><small>已赢</small><b>${x.won}</b></span><span class="${Number.isInteger(x.bid) ? '' : 'target-secret'}"><small>目标</small><b>${x.bid ?? (x.bidSubmitted ? '已锁定' : '—')}</b></span></span></div>`;
    }).join('')}</div>${foresight}<div class="played-cards ${state.trick.length>=5 ? 'compact-trick' : ''}">${state.trick.map((x, i) => {
      const pos = matchMedia('(max-width:850px)').matches ? compactPlayedPosition(x.player,selfIndex,state.players.length,matchMedia('(max-width:380px)').matches ? 360 : 390,matchMedia('(orientation:landscape) and (min-width:600px)').matches) : seatPosition(x.player, selfIndex, state.players.length, playedRadius), winnerPos = seatPosition(currentWinner ?? x.player, selfIndex, state.players.length), seat = relativeSeat(x.player, selfIndex, state.players.length);
      return `<div class="played ${currentWinner === x.player ? 'winner' : ''} ${animationBatch.some(e => e.type === 'play' && e.card?.id === x.card.id) ? 'card-enter' : ''} ${done && animationBatch.some(e => e.type === 'trickEnd') ? 'collect-winner' : ''}" data-play-seat="${seat}" style="--play-x:${pos.x}%;--play-y:${pos.y}%;--winner-dx:${winnerPos.x-pos.x}vw;--winner-dy:${(winnerPos.y-pos.y)*.4}dvh;--from-x:${Math.sin(seat * Math.PI * 2 / state.players.length) * 150}px;--from-y:${Math.cos(seat * Math.PI * 2 / state.players.length) * 100}px">${cardHTML(x.card)}<small title="${escape(state.players[x.player].name)}"><span class="played-name">${escape(state.players[x.player].name)}</span><span class="played-state" data-compact="${currentWinner===x.player ? done ? '赢墩' : '领先' : i===0 ? '首攻' : ''}">${currentWinner === x.player ? done ? '赢墩' : '暂时最大' : i===0 ? '首攻' : '&nbsp;'}</span></small></div>`;
    }).join('')}</div><div class="table-caption">已完成 ${state.completedTricks} / ${state.cardsPerRound} 墩</div></section>${ownStatusHTML(p, roundEnd)}<section class="action-panel"><div class="action-title"><h3>${state.lifecycle?.paused ? '牌局已暂停' : prompt.replace('点击金边手牌出牌', '选牌并确认出牌')}</h3><small>${lead ? `本墩跟${SUIT_NAMES[lead].split(' · ')[0]}色` : '本墩可自由出牌'}</small></div>${actionUI}${roundResult}${done && state.phase !== 'finished' && !state.lifecycle?.closeAfterRound ? isHost ? `<button id="next" class="primary">${roundEnd ? '选择下一轮规则' : '继续下一墩'} →</button>` : '<p class="muted">等待房主继续</p>' : ''}${state.lifecycle?.closeAfterRound && roundEnd ? '<button id="confirm-results" class="primary">确认结果并离开</button>' : ''}${state.phase === 'finished' && isHost && !state.lifecycle?.closeAfterRound ? '<button id="rematch" class="primary">再来一局 →</button>' : ''}</section>${!spectating ? handHTML(p, myTurn) : ''}</main><aside><section class="panel scoreboard"><div class="section-label">预言排行榜 <span>总分</span></div>${state.players.map((x, i) => ({ ...x, seat: i })).sort((a,b) => b.score - a.score).map((x, i) => `<div class="score-row"><span class="rank">${String(i + 1).padStart(2, '0')}</span><span>${escape(x.name)}${x.id === me ? '<small>你</small>' : ''}</span><b>${x.score}</b></div>`).join('')}${roundEnd ? `<div class="round-results"><h4>第 ${state.round} 轮得分</h4>${state.history.at(-1).result.map(r => `<div><span>${escape(state.players.find(x => x.id === r.id).name)} <small>${r.won}/${r.bid} 墩</small></span><b class="${r.delta > 0 ? 'positive' : 'negative'}">${r.delta > 0 ? '+' : ''}${r.delta}</b></div>`).join('')}</div>` : ''}</section><section class="panel journal"><div class="section-label">牌桌记事 <span>↙</span></div>${state.log.slice(-7).map(l => `<p>${escape(l)}</p>`).join('')}</section><details class="panel history"><summary>查看逐轮记分</summary><div class="history-scroll"><table><thead><tr><th>轮</th>${state.players.map(x => `<th>${escape(x.name)}</th>`).join('')}</tr></thead><tbody>${state.history.map(h => `<tr><td>${h.round}</td>${h.result.map(r => `<td title="预言 ${r.bid} / 赢 ${r.won}">${r.delta > 0 ? '+' : ''}${r.delta}<small>${r.total}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div></details></aside></div>`;
  }
  app.innerHTML = shell(`${head}${body}${lifecycleHTML()}`);
  if (spectating) {
    const banner = document.createElement('div'); banner.className = 'spectator-banner';
    banner.textContent = `观战中 · 仅公开信息 · ${state.spectatorCount || 0} 人观战`;
    $('.page').append(banner);
    $('.hand-section')?.remove();
  }
  bindCommon();
  handMotion.attach($('.hand'),previousHand,selectedCard);
  $('#invite')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(invitation); notify('邀请链接已复制，发给朋友吧。'); } catch { notify(`复制这个邀请链接：${invitation}`); }
  });
  $('#leave').onclick = requestLeave;
  $('#room-pause')?.addEventListener('click', () => roomControl(state.lifecycle?.paused ? 'resume' : 'pause'));
  $('#room-dissolve')?.addEventListener('click', () => { if (confirm('解散后所有成员会收到通知，旧链接无法恢复。确定解散房间？')) { if (practice) { localStorage.removeItem(PRACTICE_SAVE_KEY); leaveRoom('练习已解散。', false, false); } else roomControl('dissolve'); } });
  $('#continue-yes')?.addEventListener('click', () => roomControl('continuationVote', {accept:true}));
  $('#continue-no')?.addEventListener('click', () => roomControl('continuationVote', {accept:false}));
  $('#confirm-results')?.addEventListener('click', () => roomControl('confirmResults'));
  bindHand();
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
    if (!practice) return roomControl('addbot',{difficulty:$('#bot-difficulty')?.value || 'smart'});
    try { const id=crypto.randomUUID();addPlayer(game, id, '', true, true);game.players.find(p=>p.id===id).botDifficulty=$('#bot-difficulty')?.value || 'smart'; broadcast(); } catch (error) { notify(error.message); }
  });
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    if (!isHost || state.phase !== 'lobby') return;
    if (!practice) return roomControl('remove', {id:b.dataset.remove});
    game.players = game.players.filter(p => p.id !== b.dataset.remove); broadcast();
  });
  document.querySelectorAll('[data-bid]').forEach(b => b.onclick = () => send({ type: 'bid', value: Number(b.dataset.bid) }));
  document.querySelectorAll('button[data-trump]').forEach(b => b.onclick = () => send({ type: 'trump', suit: b.dataset.trump }));

  $('#next')?.addEventListener('click', () => send({ type: 'next' }));
  $('#rematch')?.addEventListener('click', () => send({ type: 'rematch' }));
  animationBatch = [];
}
function bindCommon() {
  const pregame = state && ['lobby', 'rules'].includes(state.phase);
  document.body.dataset.phase = state?.phase || '';
  document.body.dataset.screen = !state ? 'home' : pregame ? 'lobby' : 'game';
  document.body.dataset.connection = !state ? 'home' : practice || networkReady ? 'connected' : 'reconnecting';
  document.body.dataset.spectator = String(spectating);
  if (!state) {
    const badge = document.createElement('span');
    badge.id = 'online-count';
    badge.setAttribute('role', 'status');
    badge.title = '当前网站已连接的浏览器数（含牌局中玩家），同一浏览器多个标签页合并。断网或手机后台挂起时，离线检测可能延迟。';
    document.querySelector('.home-presence').append(badge);
    updateOnlineCount();
    directory.mount($('.home-room-list'));
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
  const soundButton = document.createElement('button'); soundButton.id = 'turn-sound'; soundButton.textContent = `行动提示音：${turnSound ? '开' : '关'}`;
  $('.top-actions').append(soundButton); soundButton.onclick = () => { turnSound = !turnSound; localStorage.setItem('wizard-turn-sound', String(turnSound)); soundButton.textContent = `行动提示音：${turnSound ? '开' : '关'}`; };
  if (state && !pregame) setupGameHUD(graphics);
  music.mount(state && !pregame ? $('#table-menu-panel') : $('.top-actions'));
  social.update(state, me, pregame ? $('.room-buttons') : $('.game-toolbar'));
  if (state) {
    const ops = document.createElement('nav'); ops.className = 'room-operations'; ops.setAttribute('aria-label', '房间操作');
    ops.innerHTML = `${isHost && !spectating ? `<button id="room-pause">${state.lifecycle?.paused ? '恢复' : '暂停'}</button>` : ''}<button id="room-leave-placeholder"></button>${isHost && !spectating ? '<button id="room-dissolve" class="danger">解散房间</button>' : ''}`;
    ops.querySelector('#room-leave-placeholder').replaceWith($('#leave')); $('.page').append(ops);
  }
  $('#chat-form').hidden = spectating;
  if (spectating) { $('#rename-toggle')?.remove(); $('#rename-panel').hidden = true; }
  if (state && !pregame) $('#table-menu-panel')?.append($('#rename-toggle'));
  setupClearUI();
  if (state) {
    const ownPlayer = state.players.find(p => p.id === me);
    if (ownPlayer) { nickname = ownPlayer.name; automaticName = !!ownPlayer.automaticName; persistName(); }
    const table = $('.table');
    if (table) renderTrumpDisplay(table, state);
    if ((!practice && !networkReady) || state.lifecycle?.paused || state.lifecycle?.continuationVote) {
      document.querySelectorAll('#start, #begin-vote, #submit-vote, #cancel-vote, #vote-form input, #addbot, [data-remove], [data-bid], [data-trump], #confirm-play, #next, #rematch').forEach(control => { control.disabled = true; });
    }
    // Social controls survive render(), so they must also be re-enabled after recovery.
    document.querySelectorAll('#chat-input, #chat-form button, #rename-input, #rename-form button').forEach(control => { control.disabled = spectating || (!practice && !networkReady); });
  }
  updateSpectatorActivity();
  document.body.dataset.paused = String(!!state?.lifecycle?.paused);
  document.body.classList.toggle('hand-expanded', handExpanded && !handCollapsed);
  document.body.classList.toggle('hand-collapsed', handCollapsed);
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
    for (const selector of ['#graphics', '#music-toggle', '#trump-motion', '#turn-sound', ...(state ? ['#rules', '#rename-toggle'] : [])]) {
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
    if (state.phase === 'play' && !$('#turn-countdown')) {
      const timer = document.createElement('span'); timer.id = 'turn-countdown';
      timer.setAttribute('role', 'timer'); timer.title = '每次出牌 30 秒，超时自动出一张合法牌';
      $('.action-panel').prepend(timer);
      updateCountdown();
    }
    updateCountdown();
  }
}
function updateCountdown() {
  if (!state) return;
  const voteTimer = $('#continuation-countdown'); if (voteTimer) voteTimer.textContent = `${Math.max(0,Math.ceil((state.lifecycle.continuationVote.deadline - Date.now() - serverClockOffset)/1000))} 秒`;
  const timer = $('#turn-countdown');
  if (!timer) return;
  if (state.lifecycle?.paused) { timer.textContent = `暂停 · ${Math.ceil((state.lifecycle.remainingMs || 0)/1000)} 秒`; return; }
  if (!practice && (!networkReady || state.lifecycle?.reconnecting)) { timer.textContent = '连接恢复中'; return; }
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
  for (const el of [$('#rules'), graphics, $('#trump-motion'), $('#turn-sound'), $('#invite')]) if (el) menu.append(el);
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

function updateSpectatorActivity() {
  const active = spectating && state && !['lobby', 'rules'].includes(state.phase);
  spectatorActivity.hidden = !active;
  if (!active) { spectatorActivity.querySelector('ol').replaceChildren(); return; }
  const list = spectatorActivity.querySelector('ol');
  if (spectatorActivity.dataset.room !== room) { list.replaceChildren(); spectatorActivity.dataset.room = room; }
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 45;
  const events = state.publicEvents?.length ? state.publicEvents : state.log.map((text, index) => ({ seq: `log-${state.round}-${index}`, text }));
  const retained = new Set(events.map(event => String(event.seq)));
  for (const row of [...list.children]) if (!retained.has(row.dataset.seq)) row.remove();
  const existing = new Map([...list.children].map(row => [row.dataset.seq, row]));
  for (const event of events) {
    let row = existing.get(String(event.seq));
    if (!row) { row = document.createElement('li'); row.dataset.seq = String(event.seq); list.append(row); }
    if (row.textContent !== event.text) row.textContent = event.text;
  }
  if (atBottom) list.scrollTop = list.scrollHeight;
}
function persistRoom() {
  if (!room || !me) return;
  const saved = practice ? { role: 'practice', room, me, game, identities, paused:practicePaused, remainingMs:practicePaused ? practiceRemaining : Number.isFinite(game.turnDeadline) ? Math.max(0,game.turnDeadline-Date.now()) : null } : { role: isHost ? 'host' : spectating ? 'spectator' : 'guest', authoritative: true, room, me, state };
  if (practice) savePractice(localStorage, {...saved,paused:practicePaused});
  else saveRoomRecovery(localStorage,{room,me,token,role:saved.role});
  if (!saveRoomSession(sessionStorage, saved)) notify('浏览器存储不可用，刷新后可能无法恢复牌局。');
}
function stopRoomTransport() {
  roomEpoch++;
  const previous = transport;
  transport = null;
  clearTimeout(botTimer); clearTimeout(turnTimer);
  previous?.stop();
}

function leaveRoom(message = '', announce = true, keep = true) {
  if (announce && !practice) transport?.send({type:'leave'});
  if (practice && keep && game) {
    const saved = {role:'practice',room,me,game,identities,paused:practicePaused,remainingMs:practicePaused ? practiceRemaining : Math.max(0,game.turnDeadline-Date.now()),leftAt:Date.now()};
    savePractice(localStorage,saved,Date.now(),true);saveRoomSession(sessionStorage,saved);
  }
  const previous = transport;
  roomEpoch++; transport = null; clearTimeout(botTimer); clearTimeout(turnTimer);
  previous?.stop();
  if (!keep) { clearRoomSession(sessionStorage); if (!practice) removeRoomRecovery(localStorage,room,token); }
  game = state = undefined; room = me = ''; identities = {};
  isHost = practice = spectating = networkReady = busy = false;
  scoresOpen = menuOpen = rulesOpen = false; previousHUDPhase = ''; selectedCard = null; pendingPlay=null;seenEventSeq = null;
  practiceSaved = readPractice(localStorage); handExpanded = false;handCollapsed=false;
  history.replaceState(null, '', location.pathname);
  notify(message); render();
}
function requestLeave() {
  const life = state.lifecycle || {};
  const duration = practice ? '10 分钟' : life.paused ? '最多 4 小时（首次离线固定截止）' : '30 分钟';
  const until = life.retentionDeadline ? new Date(life.retentionDeadline).toLocaleString('zh-CN', {hour12:false}) : new Date(Date.now() + (practice ? PRACTICE_KEEP_MS : life.paused ? 4*3600000 : 30*60000)).toLocaleString('zh-CN',{hour12:false});
  if (confirm(`${spectating ? '离开观战' : '离开房间'}不会解散牌局。${isHost || practice ? `牌局保留 ${duration}，截止 ${until}。` : '房间期限由房主在线与暂停状态决定。'}使用原浏览器返回本页可恢复${practice ? '练习' : `，房间码 ${room}`}。到期将关闭；真人房符合条件时先发起当前轮续赛投票。确定离开？`)) leaveRoom('已离开，可从原浏览器返回恢复。');
}
function roomControl(type, extra = {}) {
  if (!practice) { if (!networkReady) return notify('连接恢复中，请稍候。'); return transport?.send({type,...extra}); }
  if (type === 'pause') {
    practicePaused = true; practiceRemaining = Number.isFinite(game.turnDeadline) ? Math.max(0,game.turnDeadline-Date.now()) : null;
    clearTimeout(botTimer); clearTimeout(turnTimer); broadcast();
  } else if (type === 'resume') {
    practicePaused = false; if (Number.isFinite(practiceRemaining) && game.phase === 'play') game.turnDeadline = Date.now() + practiceRemaining; broadcast();
  }
}
function bindHand() {
  const hand = $('.hand');
  if (hand) {
    hand.scrollLeft = handExpanded ? 0 : handScroll; hand.scrollTop = handExpanded ? gridScroll : 0;
    let start = null, dragged = false;
    hand.addEventListener('pointerdown', event => { start = {x:event.clientX,y:event.clientY}; dragged = false; });
    hand.addEventListener('pointermove', event => { if (start && isSwipe(start,{x:event.clientX,y:event.clientY})) dragged = true; });
    hand.addEventListener('pointercancel', () => { dragged = true; });
    hand.addEventListener('click', event => {
      const card = event.target.closest('[data-card]'); if (!card || dragged) { dragged = false; return; }
      if(pendingPlay)return;selectedCard = card.dataset.card; render();
    });
    hand.addEventListener('scroll', () => { if (handExpanded) gridScroll = hand.scrollTop; else handScroll = hand.scrollLeft; });
  }
  $('#hand-expand')?.addEventListener('click', () => {handCollapsed=false;handExpanded = !handExpanded; render(); });
  $('#hand-collapse')?.addEventListener('click',()=>{handCollapsed=!handCollapsed;render();});
  $('#hand-sort')?.addEventListener('click', () => { handSort = handSort === 'suit' ? 'rank' : 'suit'; render(); });
  $('#cancel-card')?.addEventListener('click', () => { selectedCard = null; render(); });
  $('#confirm-play')?.addEventListener('click', () => {
    const card = state.players.find(p => p.id === me)?.hand?.find(c => c.id === selectedCard);
    if (pendingPlay || !card || playBlockedReason(state,me,card)) return;
    const id=selectedCard;pendingPlay={id,context:pendingContext(),requestId:crypto.randomUUID()};
    const button=$('#confirm-play');button.disabled=true;button.textContent='正在提交…';
    if(!send({type:'play',card:id},pendingPlay.requestId))pendingPlay=null;
    render();
  });
}
function updateEventEffects(initial = false) {
  const seq = state?.eventSeq || 0;
  animationBatch = !initial && seenEventSeq != null ? (state.events || []).filter(e => e.seq > seenEventSeq) : [];
  seenEventSeq = seq;
  const myTurn = !spectating && (state?.canBid || (state?.players[state.turn]?.id === me && ['play','trump'].includes(state.phase)));
  const cue = myTurn ? `${state.round}:${state.completedTricks}:${state.phase}:${state.turn}` : '';
  if (cue && cue !== lastTurnCue && !state.lifecycle?.paused && networkReady) {
    document.body.classList.remove('turn-arrival'); void document.body.offsetWidth; document.body.classList.add('turn-arrival');
    if (turnSound && !initial) try { const ctx = new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=660;gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.18);osc.connect(gain).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.18);osc.onended=()=>ctx.close(); } catch {}
  }
  lastTurnCue = cue;
}

function broadcast(socialOnly = false) {
  serverClockOffset = 0;
  state = viewFor(game, me);
  state.spectatorCount = 0;
  state.lifecycle = {paused:practicePaused,pauseReason:'房主主动暂停',remainingMs:practiceRemaining,retentionMs:PRACTICE_KEEP_MS};
  updateEventEffects();
  persistRoom();
  render();
  if (socialOnly || practicePaused) return;
  clearTimeout(turnTimer);
  if (game.phase === 'play' && Number.isFinite(game.turnDeadline)) {
    turnTimer = setTimeout(() => {
      try { applyPublicAction(game, me, { type: 'timeout' }); broadcast(); } catch (e) { notify(e.message); }
    }, Math.max(0, game.turnDeadline - Date.now()) + 30);
  }
  clearTimeout(botTimer);
  const bot = game.players.find(p => p.bot && p.online && botAction(game, p.id));
  if ((practice || networkReady) && bot) botTimer = setTimeout(() => {
    try { const action = botAction(game, bot.id); if (action) { applyPublicAction(game, bot.id, action); broadcast(); } } catch (e) { notify(e.message); }
  }, 750);
}
function send(action, requestId = null) {
  if (spectating) { notify('观战中，只能查看公开信息。'); return false; }
  if (!practice && !networkReady) { notify('正在恢复连接，请稍候再操作。'); return false; }
  if (practice && practicePaused && !['chat','rename'].includes(action.type)) { notify('牌局已暂停。'); return false; }
  if (practice) {
    try { applyPublicAction(game, me, action); notify(''); broadcast(['chat', 'rename'].includes(action.type)); return true; } catch (e) { notify(e.message); }
  } else if (transport?.send({ type: 'action', action, ...(requestId ? {requestId} : {}) })) return true;
  else notify('连接已中断，正在自动重连，请稍候再操作。');
  return false;
}
function startPractice() {
  if (!saveName()) return;
  stopRoomTransport(); clearRoomSession(sessionStorage); identities = {};
  spectating = false;
  practice = true; isHost = true; me = crypto.randomUUID(); room = '离线练习';
  game = createGame(); addPlayer(game, me, nickname, false, automaticName);
  addPlayer(game, crypto.randomUUID(), '', true, true); addPlayer(game, crypto.randomUUID(), '', true, true);
  networkReady = true; busy = false; game.options.short = true; practicePaused = false; practiceRemaining = null; seenEventSeq = null;
  notify(''); broadcast();
}
function launch(host, restored = null) {
  const watching = !host && restored?.role === 'spectator';
  if (!watching && !saveName()) return;
  const entered = restored?.room || $('#room-input')?.value.trim().toUpperCase();
  if (!host && !/^[A-Z2-9]{8}$/.test(entered)) return notify('请输入有效的 8 位房间码。');
  if (busy) return;
  stopRoomTransport(); const epoch = roomEpoch, current = () => roomEpoch === epoch;
  busy = true; networkReady = false; isHost = host; practice = false; spectating = watching;
  game = undefined; state = undefined; me = restored?.me || '';
  room = entered || Array.from(crypto.getRandomValues(new Uint8Array(8)), n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n & 31]).join('');
  seenEventSeq = null; selectedCard = null;pendingPlay=null;
  notify(restored ? '正在恢复房间服务中的原牌局…' : host ? '正在创建房间…' : '正在连接房间…'); render();
  let migrationPending=!!restored?.game;
  transport = createRoomTransport({host,room,token,name:nickname,automaticName,spectator:watching,snapshot:restored?.game,identities:restored?.identities,
    onFatal(message) { if (current()) leaveRoom(message,false,migrationPending); },
    onStatus(value) {
      if (!current()) return;
      networkReady = value === 'connected'; busy = !networkReady;
      if (!networkReady) { selectedCard = null;pendingPlay=null; seenEventSeq = null; }
      notify(networkReady ? '' : '房间服务连接恢复中，正在同步牌局与计时…'); render();
    },
    onData(msg) {
      if (!current()) return;
      if (msg?.type === 'state' && msg.state?.players) {
        const initial = seenEventSeq == null;
        migrationPending=false;
        me = msg.me || me; isHost = msg.isHost === true; state = msg.state;
        networkReady = true; busy = false;
        serverClockOffset = Number.isFinite(msg.serverNow) ? msg.serverNow - Date.now() : 0;
        updateEventEffects(initial); persistRoom(); transport.ready(); render();
      }
      if (msg?.type === 'error') {if(pendingPlay?.requestId===msg.requestId)pendingPlay=null;notify(msg.message);render();}
      if (msg?.type === 'removed') leaveRoom('你已被移出房间。',false,false);
      if (msg?.type === 'room-closed') leaveRoom(msg.message || '房间已关闭，旧链接无法恢复。',false,false);
    },
  });
}

const social = new RoomSocial(send);
const music = new BackgroundMusic();
const directory = new RoomDirectory({
  onWatch(selectedRoom) {
    if (busy || state) return;
    launch(false, { role: 'spectator', room: selectedRoom, me: '' });
  },
  onRefresh() { presence?.wake(); },
});
const spectatorActivity = document.createElement('section');
spectatorActivity.className = 'spectator-activity'; spectatorActivity.hidden = true;
spectatorActivity.setAttribute('aria-label', '观战公开操作记录');
spectatorActivity.innerHTML = '<h2>公开操作</h2><ol aria-live="polite" aria-relevant="additions"></ol>';
document.body.append(spectatorActivity);
let presence;
setInterval(updateCountdown, 250);
render();
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
    visitor,
    onChange: value => { onlinePresence = value; updateOnlineCount(); directory.update({ rooms: value.rooms || [], status: value.status }); },
  });
}
startPresence();
function restoreRoom(saved) {
  if (!saved) return;
  busy = false;
  if (saved.role === 'practice') {
    stopRoomTransport();
    ({ game, identities, room, me } = saved);
    practicePaused = saved.paused === true; practiceRemaining = saved.remainingMs;
    if (Number.isFinite(saved.remainingMs) && game.phase === 'play') game.turnDeadline = Date.now() + saved.remainingMs;
    normalizeGame(game);
    if (game.phase === 'play' && !Number.isFinite(game.turnDeadline)) game.turnDeadline = Date.now() + TURN_MS;
    isHost = practice = networkReady = true; spectating = false;
    notify('已恢复原来的练习牌局。'); broadcast();
  } else launch(saved.role === 'host', saved);
}
window.addEventListener('pagehide', () => {
  if (practice && game) {
    const saved={role:'practice',room,me,game,identities,paused:practicePaused,remainingMs:practicePaused ? practiceRemaining : Math.max(0,game.turnDeadline-Date.now()),leftAt:Date.now()};
    savePractice(localStorage,saved,Date.now(),true);saveRoomSession(sessionStorage,saved);
  } else persistRoom();
  stopRoomTransport(); networkReady = false; busy = false;
  presence?.stop();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { startPresence(); restoreRoom(readRoomSession(sessionStorage)); }
});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state)render();},120);});
for(const query of ['(max-width:380px)','(max-width:850px)']) matchMedia(query).addEventListener('change',()=>{if(state)render();});
window.addEventListener('offline',()=>{
  if(!practice) {networkReady=false;pendingPlay=null;selectedCard=null;seenEventSeq=null;transport?.wake();if(state){notify('网络已断开，正在恢复房间服务连接…');render();}}
  presence?.wake();
});
window.addEventListener('online', () => { transport?.wake(); presence?.wake(); });
restoreRoom(watchFromURL && /^[A-Z2-9]{8}$/.test(roomFromURL) && savedSession?.role !== 'host'
  ? (savedSession?.role === 'spectator' ? savedSession : { role: 'spectator', room: roomFromURL, me: '' })
  : savedSession);
