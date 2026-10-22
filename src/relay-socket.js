// Reconnect obtains a fresh host snapshot; game actions are never replayed.
export function relayURL(path, base = import.meta.env?.VITE_RELAY_URL || globalThis.location?.origin) {
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
export function connectRelay({ url, hello, WebSocket = globalThis.WebSocket,
  onMessage = () => {}, onDisconnect = () => {}, onFatal = () => {},
  retryMs = 500, maxRetryMs = 8000, timeoutMs = 15000, heartbeatMs = 25000 }) {
  let socket, retryTimer, deadline, heartbeat, stopped = false, attempt = 0, generation = 0;
  function clear() { clearTimeout(retryTimer); clearTimeout(deadline); clearInterval(heartbeat); }
  function dispose() {
    generation++; clear();
    const previous = socket; socket = null;
    try { previous?.close(); } catch {}
  }
  function retry() {
    if (stopped) return;
    dispose(); onDisconnect();
    if (!stopped) retryTimer = setTimeout(start, Math.min(maxRetryMs, retryMs * 2 ** Math.min(attempt++, 10)));
  }
  function send(value) {
    if (stopped || socket?.readyState !== 1) return false;
    try { socket.send(typeof value === 'string' ? value : JSON.stringify(value)); return true; }
    catch { retry(); return false; }
  }
  function start() {
    if (stopped) return;
    const stamp = ++generation;
    let next;
    try { next = new WebSocket(url); } catch { retry(); return; }
    socket = next;
    const current = () => !stopped && stamp === generation && socket === next;
    let lastSeen = Date.now();
    deadline = setTimeout(() => { if (current()) retry(); }, timeoutMs);
    next.addEventListener('open', () => {
      if (!current()) return;
      send(hello);
      heartbeat = setInterval(() => {
        if (Date.now() - lastSeen > heartbeatMs * 2) retry();
        else send('ping');
      }, heartbeatMs);
    });
    next.addEventListener('message', event => {
      if (!current()) return;
      lastSeen = Date.now();
      if (event.data === 'pong') return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'fatal') {
        stopped = true; dispose(); onDisconnect(); onFatal(message.message); return;
      }
      if (message.type === 'ready') { clearTimeout(deadline); attempt = 0; }
      onMessage(message);
    });
    next.addEventListener('close', () => { if (current()) retry(); });
    next.addEventListener('error', () => { if (current()) retry(); });
  }
  start();
  return {
    send,
    stop() { stopped = true; dispose(); },
    wake() { if (!stopped) { dispose(); onDisconnect(); attempt = 0; start(); } },
  };
}
