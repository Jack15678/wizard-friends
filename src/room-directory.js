const phaseNames = {
  lobby: '等待开局', rules: '规则投票', trump: '选择主牌', bid: '预估阶段',
  play: '出牌阶段', trickEnd: '本墩结算', roundEnd: '本轮结算', finished: '本局结束',
};
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };

// The dialog and room rows outlive #app renders. Only public room metadata is
// accepted here; joining and refreshing remain the caller's responsibility.
export class RoomDirectory {
  constructor({ onWatch = () => {}, onRefresh = () => {} } = {}) {
    this.onWatch = onWatch;
    this.onRefresh = onRefresh;
    this.status = 'loading';
    this.rows = new Map();
    this.root = document.createElement('dialog');
    this.root.id = 'room-directory';
    this.root.className = 'room-directory';
    this.root.setAttribute('aria-labelledby', 'room-directory-title');
    this.root.setAttribute('aria-describedby', 'room-directory-status');
    this.root.innerHTML = `
      <header class="room-directory-heading">
        <h2 id="room-directory-title">正在进行的牌局</h2>
        <div class="room-directory-tools">
          <button type="button" id="refresh-rooms">刷新</button>
          <button type="button" id="close-room-directory" aria-label="关闭观战房间列表" autofocus>关闭</button>
        </div>
      </header>
      <p id="room-directory-status" class="room-directory-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <ul class="room-directory-list" aria-label="可观战的房间"></ul>
      <p class="room-directory-empty" hidden>当前没有正在进行的牌局。</p>
      <p class="room-directory-note">观战仅显示公开信息。</p>`;
    document.body.append(this.root);
    this.list = this.root.querySelector('.room-directory-list');
    this.message = this.root.querySelector('#room-directory-status');
    this.empty = this.root.querySelector('.room-directory-empty');
    this.refreshButton = this.root.querySelector('#refresh-rooms');
    this.closeButton = this.root.querySelector('#close-room-directory');
    this.closeButton.onclick = () => this.close();
    this.refreshButton.onclick = () => {
      this.update({ status: 'loading' });
      try {
        const pending = this.onRefresh();
        if (pending?.catch) pending.catch(() => this.update({ status: 'unavailable' }));
      } catch { this.update({ status: 'unavailable' }); }
    };
    this.root.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.root.addEventListener('close', () => this.syncTrigger());
    this.renderStatus();
  }

  // Pass a container to insert/reuse our menu button, or an existing <button>
  // to bind it. Call again after the homepage renders; the dialog is not rebuilt.
  mount(target) {
    if (!target) return this.button;
    if (target.tagName === 'BUTTON') {
      if (this.button !== target) {
        this.button?.removeEventListener('click', this.openListener);
        this.button = target;
        this.openListener = () => this.open();
        this.button.addEventListener('click', this.openListener);
      }
    } else {
      if (!this.button) {
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.id = 'watch-menu';
        this.button.className = 'menu-choice room-directory-trigger';
        this.button.textContent = '观战房间';
        this.openListener = () => this.open();
        this.button.addEventListener('click', this.openListener);
      }
      target.append(this.button);
    }
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-controls', this.root.id);
    this.syncTrigger();
    return this.button;
  }

  syncTrigger() { this.button?.setAttribute('aria-expanded', String(this.root.open)); }

  open() {
    if (this.root.open) return;
    this.returnFocus = document.activeElement;
    this.root.showModal();
    this.syncTrigger();
    this.closeButton.focus({ preventScroll: true });
  }

  close() {
    if (!this.root.open) return;
    this.root.close();
    this.syncTrigger();
    const target = this.button?.isConnected ? this.button : this.returnFocus;
    if (target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  makeRow(room) {
    const node = document.createElement('li');
    node.className = 'room-directory-item';
    node.dataset.room = room;
    node.innerHTML = `
      <div class="room-directory-details">
        <h3 class="room-directory-host"></h3>
        <p class="room-directory-code"></p>
        <p class="room-directory-progress"><span class="directory-phase"></span><span class="directory-round"></span></p>
        <p class="room-directory-counts"><span class="directory-players"></span><span class="directory-spectators"></span></p>
      </div>
      <button type="button" class="room-directory-watch">进入观战</button>`;
    const row = {
      node, host: node.querySelector('.room-directory-host'), code: node.querySelector('.room-directory-code'),
      phase: node.querySelector('.directory-phase'), round: node.querySelector('.directory-round'),
      players: node.querySelector('.directory-players'), spectators: node.querySelector('.directory-spectators'),
      button: node.querySelector('.room-directory-watch'),
    };
    row.button.onclick = () => { this.close(); this.onWatch(room); };
    this.rows.set(room, row);
    this.list.append(node);
    return row;
  }

  update({ rooms, status } = {}) {
    if (status !== undefined) this.status = ['ready', 'online', 'connected'].includes(status) ? 'ready'
      : ['loading', 'connecting', 'refreshing'].includes(status) ? 'loading' : 'unavailable';
    else if (Array.isArray(rooms)) this.status = 'ready';
    if (Array.isArray(rooms)) {
      const scroll = this.list.scrollTop;
      const active = document.activeElement;
      const seen = new Set();
      for (const item of rooms) {
        const room = typeof item?.room === 'string' ? item.room.trim().toUpperCase() : '';
        if (!room || seen.has(room)) continue;
        seen.add(room);
        const row = this.rows.get(room) || this.makeRow(room);
        const host = typeof item.hostName === 'string' && item.hostName.trim() ? item.hostName.trim() : '未命名房主';
        const round = count(item.round), maxRounds = count(item.maxRounds);
        text(row.host, `${host} 的房间`);
        text(row.code, `房间 ${room}`);
        text(row.phase, phaseNames[item.phase] || '对局进行中');
        text(row.round, round ? `第 ${round}${maxRounds ? ` / ${maxRounds}` : ''} 轮` : '尚未发牌');
        text(row.players, `${Array.isArray(item.players) ? item.players.length : count(item.players)} 人牌局`);
        text(row.spectators, `${count(item.spectators)} 人观战`);
        row.button.setAttribute('aria-label', `进入 ${host} 的房间 ${room} 观战`);
      }
      // Keep existing rows in place even if discovery changes its sort order.
      // This preserves keyboard focus and the reader's position while watching.
      for (const [room, row] of this.rows) if (!seen.has(room)) {
        this.rows.delete(room);
        row.node.remove();
      }
      if (this.root.open && active && !active.isConnected) this.refreshButton.focus({ preventScroll: true });
      this.list.scrollTop = scroll;
    }
    this.renderStatus();
  }

  renderStatus() {
    const size = this.rows.size;
    this.root.dataset.status = this.status;
    this.list.setAttribute('aria-busy', String(this.status === 'loading'));
    this.empty.hidden = this.status !== 'ready' || size > 0;
    this.list.hidden = size === 0;
    text(this.message, this.status === 'loading'
      ? (size ? '正在刷新房间列表…' : '正在查找进行中的房间…')
      : this.status === 'unavailable'
        ? (size ? '房间列表暂不可用，上次列表可能已变化。请稍后刷新。' : '房间列表暂不可用，请稍后刷新。')
        : size ? `${size} 个房间正在进行牌局` : '房间列表已更新');
  }
}
