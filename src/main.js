import Peer from 'peerjs';
import { createGame, addPlayer, act, viewFor, botAction, SUITS, SUIT_NAMES } from './game.js';
import './style.css';
import './cinematic.css';
import './fullscreen.css';
import './home-menu.css';
import './lobby.css';
import './social.css';
import { RoomSocial } from './room-social.js';
import { trumpStyle } from './trump-style.js';
import { cardImage } from './card-art.js';
import { createPresence, presenceRoom } from './presence.js';

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
let scoresOpen = false, menuOpen = false, previousHUDPhase = '';
let joinOpen = new URLSearchParams(location.search).has('room');
let joinDraft = null;
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
  if (!state) return `<div class="page">${body}<header class="topbar home-tools"><div class="top-actions"><button class="text-button" id="rules">游戏规则</button></div></header></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
  return `<div class="page"><header class="topbar"><a class="brand" href="${location.pathname}"><span class="brand-icon">✦</span><span>巫师牌<small>WIZARD / FRIENDS TABLE</small></span></a><div class="top-actions"><span class="tag">好友之间，预言成真</span><button class="text-button" id="rules">游戏规则 ↗</button></div></header>${body}<footer><span>一副牌，无数种预言。</span><span>非官方好友同乐版 · 牌面原创绘制</span></footer></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
}
function rulesHTML() {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="rule-title"><button class="close" id="close-rules" aria-label="关闭规则">×</button><div class="eyebrow">THE ART OF PREDICTION</div><h2 id="rule-title">先预言，再出牌。</h2><p>3–6 人，共 60 张牌：四种花色各 1–13，以及 4 张巫师、4 张小丑。第 N 轮每人发 N 张牌。</p><ol><li><b>确定王牌。</b>翻开的数字牌花色是本轮王牌；翻到巫师由庄家选色，小丑或牌库用尽则无王牌。</li><li><b>预言墩数。</b>从庄家左手开始，依次预测自己本轮能赢几墩。每人出一张牌，组成一墩。</li><li><b>依次出牌。</b>有首攻花色就必须跟色；巫师和小丑随时能出。巫师起手可任意出牌；小丑起手则看第一张非小丑牌。</li><li><b>判定赢家。</b>最先出的巫师 ＞ 最大王牌 ＞ 首攻花色最大牌。全是小丑则第一张赢。赢家下一墩先出。</li><li><b>计分。</b>猜中得 20 + 10 × 赢墩数；猜错每差一墩扣 10 分。总分最高者胜出，同分共享胜利。</li></ol><p>标准局：3/4/5/6 人分别 20/15/12/10 轮。快速局为本站的 5 轮练习变体。「预言总和不能相等」是可选变体，由最后预言的人避开总和等于本轮墩数。</p><p class="muted">联机需保持房主页面打开；房主可看到全部对局数据，请与信任的朋友同玩。严格网络可能无法建立直连，可切换网络或配置自有 TURN 服务。</p><a href="https://blog.amigo-spiele.de/content/ap/rule/06900-GB-AmigoRule.pdf" target="_blank" rel="noopener">查看 AMIGO 官方规则 ↗</a></section></div>`;
}
function render() {
  if (!state) {
    app.innerHTML = shell(`<main class="home-screen">
      <section class="hero home-scene" aria-label="烛光牌桌"><div class="hero-cards">${cardHTML({ kind: 'number', suit: 'blue', rank: 13 })}${cardHTML({ kind: 'wizard' })}${cardHTML({ kind: 'number', suit: 'red', rank: 7 })}</div></section>
      <section class="home-menu" aria-label="主菜单">
        <div class="home-title"><span class="title-ornament" aria-hidden="true">✦</span><h1>巫师牌</h1><span class="home-wordmark">W I Z A R D</span></div>
        <nav class="menu-options" aria-label="开始游戏">
          <button id="create" class="menu-choice menu-primary" ${busy ? 'disabled' : ''}>${busy ? '正在连接…' : '创建牌局'}<span aria-hidden="true">↗</span></button>
          <button id="join-menu" class="menu-choice" aria-expanded="${joinOpen}" aria-controls="join-form" ${busy ? 'disabled' : ''}>加入房间<span aria-hidden="true">＋</span></button>
          <form id="join-form" class="menu-join" ${joinOpen ? '' : 'hidden'}><label class="sr-only" for="room-input">房间码</label><input id="room-input" placeholder="输入房间码" maxlength="24" autocomplete="off" value="${escape(joinDraft ?? (roomFromURL || storedRoom))}"><button id="join" type="submit" ${busy ? 'disabled' : ''}>加入</button></form>
          <button id="practice" class="menu-choice" ${busy ? 'disabled' : ''}>单人练习<span aria-hidden="true">↗</span></button>
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
    $('#nickname').oninput = e => { nickname = e.target.value; };
    return;
  }
  const p = state.players.find(p => p.id === me);
  const myTurn = state.players[state.turn]?.id === me;
  const hostName = state.players[0]?.name;
  const invitation = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  const head = `<div class="room-heading"><div class="room-identity"><span>${practice ? '练习牌桌' : '房间'}</span><span class="room-code">${practice ? '' : escape(room)}</span><span class="seat-count">${state.players.length} / 6</span></div><div class="room-buttons">${!practice ? '<button id="invite">邀请好友 ↗</button>' : ''}<button id="leave" class="text-button">离开</button></div></div>`;
  let body;
  if (state.phase === 'lobby') {
    const startHint = state.players.length < 3 ? `还差 ${3 - state.players.length} 人` : state.players.some(p => !p.online) ? '等待玩家重连' : '';
    body = `<main class="lobby-table">
      <div class="hero lobby-scene" aria-hidden="true"><div class="lobby-felt"></div></div>
      <div class="seats" aria-label="房间座位">${state.players.map((p, i) => `<div class="seat ${p.id === me ? 'my-seat' : ''} ${!p.online ? 'offline' : ''}"><div class="avatar">${p.bot ? '✧' : escape(p.name.slice(0, 1))}</div><div class="seat-name"><b>${escape(p.name)}</b><small>${i === 0 ? '房主' : p.bot ? '机器人' : p.online ? '已入座' : '离线'}</small></div>${isHost && i > 0 ? `<button data-remove="${escape(p.id)}" class="text-button" aria-label="移除 ${escape(p.name)}" title="移除玩家">×</button>` : ''}</div>`).join('')}${Array.from({ length: 6 - state.players.length }, () => '<div class="seat empty"><div class="avatar">＋</div><span>空位</span></div>').join('')}</div>
      <div class="lobby-controls">
        <div class="lobby-options">${isHost && state.players.length < 6 ? '<button id="addbot" class="text-button">＋ 机器人</button>' : ''}
          <label class="check"><input type="checkbox" id="short" ${short ? 'checked' : ''} ${isHost ? '' : 'disabled'}> 快速局 · 5 轮</label>
          <label class="check" title="最后一人的预言不能使总和等于本轮墩数"><input type="checkbox" id="strict" ${strict ? 'checked' : ''} ${isHost ? '' : 'disabled'}> 预言挑战</label>
        </div>
        <div class="lobby-start">${isHost ? `${startHint ? `<span class="start-hint">${startHint}</span>` : ''}<button id="start" class="primary" ${startHint ? 'disabled' : ''}>开始游戏 →</button>` : `<span class="start-hint">等待 ${escape(hostName)} 开始</span>`}</div>
      </div>
    </main>`;
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
  document.querySelectorAll('button[data-trump]').forEach(b => b.onclick = () => send({ type: 'trump', suit: b.dataset.trump }));
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => send({ type: 'play', card: b.dataset.card }));
  $('#next')?.addEventListener('click', () => send({ type: 'next' }));
  $('#rematch')?.addEventListener('click', () => {
    const players = game.players.map(p => ({ ...p, hand: [], won: 0, bid: null, score: 0 }));
    const { chat, chatSeq } = game;
    game = createGame(); game.players = players; game.options = { short, strict };
    game.chat = chat; game.chatSeq = chatSeq; broadcast();
  });
}
function bindCommon() {
  document.body.dataset.screen = !state ? 'home' : state.phase === 'lobby' ? 'lobby' : 'game';
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
  if (state && state.phase !== 'lobby') setupGameHUD(graphics);
  social.update(state, me, state?.phase === 'lobby' ? $('.room-buttons') : $('.game-toolbar'));
  if (state && state.phase !== 'lobby') $('#table-menu-panel')?.append($('#rename-toggle'));
  if (state) {
    const ownName = state.players.find(p => p.id === me)?.name;
    if (ownName && ownName !== nickname) {
      nickname = ownName;
      try { localStorage.setItem('wizard-name', nickname); } catch {}
    }
    const table = $('.table');
    if (table) {
      const trump = trumpStyle(state);
      table.dataset.trumpSuit = trump.suit;
      table.style.setProperty('--trump-color', trump.color);
      $('.trump-marker').style.color = trump.color;
      if (trump.pending) $('.trump-marker').textContent = '王牌待选';
      const marker = document.createElement('div');
      marker.className = 'table-trump';
      marker.textContent = trump.pending ? '等待选择王牌' : state.trump ? `本轮王牌 · ${SUIT_NAMES[state.trump]}` : '本轮无王牌';
      table.append(marker);
    }
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
  $('#rules').onclick = () => { menuOpen = false; rulesOpen = true; render(); $('#close-rules')?.focus(); };
  $('#close-rules')?.addEventListener('click', () => { rulesOpen = false; render(); $('#rules')?.focus(); });
}
function setupGameHUD(graphics) {
  if (state.phase === 'finished' && previousHUDPhase !== 'finished') scoresOpen = true;
  previousHUDPhase = state.phase;
  const toolbar = document.createElement('nav');
  toolbar.className = 'game-toolbar'; toolbar.setAttribute('aria-label', '对局工具');
  toolbar.innerHTML = '<button id="table-menu" aria-controls="table-menu-panel">☰ 菜单</button><button id="table-scores" aria-controls="table-score-panel">计分</button>';
  $('.page').append(toolbar);
  const menu = document.createElement('section');
  menu.id = 'table-menu-panel'; menu.className = 'table-menu-panel';
  const title = document.createElement('p');
  title.textContent = practice ? '离线练习' : `房间 ${room}`; menu.append(title);
  for (const el of [$('#rules'), graphics, $('#invite'), $('#leave')]) if (el) menu.append(el);
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
  nickname = nickname.trim();
  if (!nickname) nickname = '旅途中的巫师';
  localStorage.setItem('wizard-name', nickname);
}
function broadcast(socialOnly = false) {
  state = viewFor(game, me);
  short = game.options.short; strict = game.options.strict;
  if (!practice) {
    try { sessionStorage.setItem('wizard-host', JSON.stringify({ game, identities, room, me })); } catch { notify('浏览器存储不可用，房主刷新后将无法恢复对局。'); }
    for (const [id, conn] of peers) if (conn.open) conn.send({ type: 'state', state: viewFor(game, id) });
  }
  render();
  if (socialOnly) return;
  clearTimeout(botTimer);
  if (botAction(game)) botTimer = setTimeout(() => {
    try { const action = botAction(game); if (action) { act(game, game.players[game.turn].id, action); broadcast(); } } catch (e) { notify(e.message); }
  }, 750);
}
function send(action) {
  if (isHost) {
    try { act(game, me, action); notify(''); broadcast(['chat', 'rename'].includes(action.type)); return true; } catch (e) { notify(e.message); }
  } else if (connection?.open) { connection.send({ type: 'action', action }); return true; }
  else notify('连接已中断，请刷新页面重新加入。');
  return false;
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
          act(game, id, msg.action); broadcast(['chat', 'rename'].includes(msg.action.type));
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
const social = new RoomSocial(send);
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
window.addEventListener('pagehide', () => presence?.stop());
window.addEventListener('pageshow', event => { if (event.persisted) startPresence(); });
try {
  const saved = JSON.parse(sessionStorage.getItem('wizard-host') || 'null');
  if (saved && (!roomFromURL || saved.room === roomFromURL)) launch(true, saved);
} catch { sessionStorage.removeItem('wizard-host'); }
