// This panel lives outside #app so game-state updates never interrupt typing.
export class RoomSocial {
  constructor(send) {
    this.send = send;
    this.seen = 0;
    this.root = document.createElement('div');
    this.root.id = 'room-social';
    this.root.hidden = true;
    this.root.innerHTML = `
      <section id="room-chat" class="social-panel" aria-label="房间聊天" hidden>
        <div class="social-heading"><b>房间聊天</b><button id="close-chat" aria-label="收起聊天">×</button></div>
        <div id="chat-messages" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
        <form id="chat-form"><label class="sr-only" for="chat-input">聊天消息</label><input id="chat-input" maxlength="300" autocomplete="off" placeholder="说点什么…"><button type="submit">发送</button></form>
      </section>
      <section id="rename-panel" class="social-panel" aria-label="修改昵称" hidden>
        <div class="social-heading"><b>修改昵称</b><button id="close-rename" aria-label="取消改名">×</button></div>
        <form id="rename-form"><label class="sr-only" for="rename-input">新昵称</label><input id="rename-input" maxlength="16" required autocomplete="off"><button type="submit">保存</button></form>
      </section>`;
    document.body.append(this.root);
    this.chat = this.root.querySelector('#room-chat');
    this.rename = this.root.querySelector('#rename-panel');
    this.list = this.root.querySelector('#chat-messages');
    this.input = this.root.querySelector('#chat-input');
    this.nameInput = this.root.querySelector('#rename-input');
    this.root.querySelector('#close-chat').onclick = () => { this.chat.hidden = true; this.refreshButton(); this.chatButton?.focus(); };
    this.root.querySelector('#close-rename').onclick = () => { this.rename.hidden = true; this.renameButton?.focus(); };
    this.root.querySelector('#chat-form').onsubmit = event => {
      event.preventDefault();
      if (this.input.value.trim() && this.send({ type: 'chat', text: this.input.value })) this.input.value = '';
      this.input.focus();
    };
    this.root.querySelector('#rename-form').onsubmit = event => {
      event.preventDefault();
      if (this.send({ type: 'rename', name: this.nameInput.value })) this.rename.hidden = true;
    };
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        this.chat.hidden = this.rename.hidden = true;
        this.refreshButton();
      }
    });
  }
  refreshButton() {
    if (!this.chatButton) return;
    const unread = (this.messages || []).filter(m => m.seq > this.seen && m.player !== this.me).length;
    this.chatButton.textContent = `聊天${this.chat.hidden && unread ? ` · ${unread}` : ''}`;
    this.chatButton.setAttribute('aria-expanded', String(!this.chat.hidden));
  }
  update(state, me, controls) {
    this.root.hidden = !state;
    if (!state) {
      this.chat.hidden = this.rename.hidden = true;
      this.list.replaceChildren(); this.key = null; this.seen = 0; this.input.value = '';
      return;
    }
    if (!controls) return;
    this.me = me;
    this.messages = state.chat || [];
    this.chatButton = document.createElement('button');
    this.chatButton.id = 'chat-toggle';
    this.chatButton.setAttribute('aria-controls', 'room-chat');
    this.chatButton.onclick = () => {
      this.chat.hidden = !this.chat.hidden;
      this.rename.hidden = true;
      if (!this.chat.hidden) {
        this.seen = state.chatSeq || 0;
        this.list.scrollTop = this.list.scrollHeight;
        this.input.focus();
      }
      this.refreshButton();
    };
    this.renameButton = document.createElement('button');
    this.renameButton.id = 'rename-toggle';
    this.renameButton.textContent = '改名';
    this.renameButton.onclick = () => {
      this.chat.hidden = true; this.rename.hidden = false;
      this.nameInput.value = state.players.find(p => p.id === me)?.name || '';
      this.nameInput.focus(); this.nameInput.select(); this.refreshButton();
    };
    controls.prepend(this.chatButton, this.renameButton);
    if (!this.chat.hidden) this.seen = state.chatSeq || 0;
    const key = JSON.stringify(this.messages);
    if (key !== this.key) {
      const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
      this.key = key;
      // Retain existing nodes so screen readers announce only newly added messages.
      const retained = new Set(this.messages.map(m => String(m.seq)));
      for (const node of this.list.children) if (!retained.has(node.dataset.seq)) node.remove();
      for (const message of this.messages) {
        if ([...this.list.children].some(node => node.dataset.seq === String(message.seq))) continue;
        const row = document.createElement('p'); row.dataset.seq = message.seq;
        row.className = message.player === me ? 'own-message' : '';
        const name = document.createElement('b'); name.textContent = message.name;
        const text = document.createElement('span'); text.textContent = message.text;
        row.append(name, text); this.list.append(row);
      }
      if (atBottom) this.list.scrollTop = this.list.scrollHeight;
    }
    this.refreshButton();
  }
}
