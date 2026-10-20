// Browser-only PeerJS substitute for refresh-smoke.mjs. Never imported by the app.
// Same-origin tabs exchange messages over BroadcastChannel; sessionStorage stays
// independent in each tab, just as it does during a real multiplayer refresh.
const channelName = 'wizard-refresh-smoke-peer-v1';
const registryPrefix = 'wizard-refresh-smoke-peer:';
const livePeers = new Set();
const leaseMs = 3000;
const releaseDelayMs = 650;

class Events {
  constructor() { this.listeners = new Map(); }
  on(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
    return this;
  }
  once(name, listener) {
    const once = (...args) => { this.off(name, once); listener(...args); };
    return this.on(name, once);
  }
  off(name, listener) { this.listeners.get(name)?.delete(listener); return this; }
  removeAllListeners(name) {
    if (name) this.listeners.delete(name);
    else this.listeners.clear();
    return this;
  }
  emit(name, ...args) {
    for (const listener of [...(this.listeners.get(name) || [])]) listener(...args);
  }
}

function lookup(id) {
  try {
    const record = JSON.parse(localStorage.getItem(registryPrefix + id) || 'null');
    return record?.expires > Date.now() ? record : null;
  } catch { return null; }
}
function peerError(type, message) { return Object.assign(new Error(message), { type }); }

class DataConnection extends Events {
  constructor(provider, remote, remoteOwner, connectionId = crypto.randomUUID()) {
    super();
    this.provider = provider;
    this.peer = remote;
    this.remoteOwner = remoteOwner;
    this.connectionId = connectionId;
    this.open = false;
    this.closed = false;
    this.provider.connections.set(connectionId, this);
  }
  send(data) {
    if (this.open && !this.closed) this.provider.post(this, 'data', { data });
  }
  activate() {
    if (this.closed || this.provider.destroyed) return;
    clearTimeout(this.deadline);
    this.open = true;
    this.emit('open');
  }
  close() { this.finish(true); }
  finish(tellRemote, silent = false) {
    if (this.closed) return;
    clearTimeout(this.deadline);
    this.closed = true;
    this.open = false;
    if (tellRemote) this.provider.post(this, 'close');
    this.provider.connections.delete(this.connectionId);
    if (!silent) this.emit('close');
  }
}

export class Peer extends Events {
  constructor(id, options = {}) {
    super();
    if (id && typeof id === 'object') { options = id; id = undefined; }
    this.options = options;
    this.requestedId = id || `local-peer-${crypto.randomUUID()}`;
    this.id = this.requestedId;
    this.owner = crypto.randomUUID();
    this.open = false;
    this.disconnected = false;
    this.destroyed = false;
    this.connections = new Map();
    this.channel = new BroadcastChannel(channelName);
    this.channel.onmessage = event => this.receive(event.data);
    livePeers.add(this);
    this.startTimer = setTimeout(() => this.claim(), 10);
  }
  claim() {
    if (this.destroyed) return;
    const previous = lookup(this.requestedId);
    if (previous && previous.owner !== this.owner) {
      this.emit('error', peerError('unavailable-id', `Peer ID ${this.requestedId} is still reserved`));
      this.destroy();
      return;
    }
    this.id = this.requestedId;
    this.disconnected = false;
    this.open = true;
    const renew = () => {
      if (this.open && !this.destroyed) localStorage.setItem(registryPrefix + this.id,
        JSON.stringify({ owner: this.owner, expires: Date.now() + leaseMs }));
    };
    renew();
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(renew, 500);
    this.emit('open', this.id);
  }
  post(connection, kind, extra = {}) {
    if (this.destroyed) return;
    this.channel.postMessage({ kind, from: this.requestedId, owner: this.owner,
      to: connection.peer, recipient: connection.remoteOwner,
      connectionId: connection.connectionId, ...extra });
  }
  connect(remote) {
    const record = lookup(remote);
    const connection = new DataConnection(this, remote, record?.owner);
    connection.deadline = setTimeout(() => {
      if (connection.open || connection.closed || this.destroyed) return;
      this.emit('error', peerError('peer-unavailable', `Peer ${remote} did not answer`));
      connection.close();
    }, 750);
    if (this.open && record && !record.closing) this.post(connection, 'connect');
    return connection;
  }
  receive(message) {
    if (this.destroyed || message?.to !== this.requestedId || message.recipient !== this.owner) return;
    let connection = this.connections.get(message.connectionId);
    if (message.kind === 'connect') {
      if (!this.open || connection) return;
      connection = new DataConnection(this, message.from, message.owner, message.connectionId);
      this.emit('connection', connection);
      if (!connection.closed) {
        connection.activate();
        this.post(connection, 'accept');
      }
      return;
    }
    if (!connection || connection.closed || connection.remoteOwner !== message.owner) return;
    if (message.kind === 'accept') connection.activate();
    else if (message.kind === 'data' && connection.open) connection.emit('data', message.data);
    else if (message.kind === 'close') connection.finish(false);
  }
  release() {
    clearTimeout(this.startTimer);
    clearInterval(this.heartbeat);
    if (lookup(this.requestedId)?.owner === this.owner) {
      // A short lease after a room owner leaves exercises unavailable-id retry.
      if (this.requestedId.startsWith('wizard-friends-')) localStorage.setItem(registryPrefix + this.requestedId,
        JSON.stringify({ owner: this.owner, expires: Date.now() + releaseDelayMs, closing: true }));
      else localStorage.removeItem(registryPrefix + this.requestedId);
    }
  }
  disconnect() {
    if (this.disconnected || this.destroyed) return;
    this.release();
    this.open = false;
    this.disconnected = true;
    this.id = null;
    this.emit('disconnected', this.requestedId);
  }
  reconnect() {
    if (this.destroyed) throw new Error('Cannot reconnect a destroyed Peer');
    if (this.disconnected) this.startTimer = setTimeout(() => this.claim(), 10);
  }
  destroy() {
    if (this.destroyed) return;
    // Match PeerJS: disconnected fires before destroyed becomes true.
    this.disconnect();
    this.dispose(false);
  }
  dispose(silent) {
    if (this.destroyed) return;
    this.release();
    for (const connection of [...this.connections.values()]) connection.finish(true, silent);
    this.destroyed = true;
    this.open = false;
    this.channel.close();
    livePeers.delete(this);
    if (!silent) this.emit('close');
  }
}

globalThis.__wizardLocalPeerFixture = true;
window.addEventListener('pagehide', () => {
  for (const peer of [...livePeers]) peer.dispose(true);
});
export default Peer;
