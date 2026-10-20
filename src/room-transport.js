// Owns PeerJS lifetimes only. Room identity, admission and state stay with callers.
export function createRoomTransport({
  Peer, host, room, options = {}, onStatus = () => {}, onData = () => {}, onOpen = () => {},
  onConnection = () => {}, retryMs = 500, maxRetryMs = 8000, timeoutMs = 15000,
}) {
  const roomId = `wizard-friends-${room}`;
  const delayLimit = Math.max(0, maxRetryMs);
  const baseDelay = Math.min(Math.max(0, retryMs), delayLimit);
  let stopped = false;
  let generation = 0;
  let peer = null;
  let connection = null;
  let opened = false;
  let connected = false;
  let signalingDown = false;
  let retryAttempt = 0;
  let signalAttempt = 0;
  let retryTimer = null;
  let timeoutTimer = null;
  let signalTimer = null;
  let status = null;

  const delay = attempt => Math.min(delayLimit, baseDelay * 2 ** Math.min(attempt, 30));
  const current = (token, instance) => !stopped && token === generation && instance === peer;
  function report(next) {
    if (status === next || stopped) return;
    status = next;
    onStatus(next);
  }
  function clearTimers() {
    clearTimeout(retryTimer);
    clearTimeout(timeoutTimer);
    clearTimeout(signalTimer);
    retryTimer = timeoutTimer = signalTimer = null;
  }
  function dispose() {
    // Invalidate listeners before destroy(), which can synchronously emit close.
    generation++;
    clearTimers();
    const previous = peer;
    peer = null;
    connection = null;
    opened = connected = signalingDown = false;
    try { previous?.destroy(); } catch { /* Already unusable. */ }
  }
  function retry(immediate = false) {
    if (stopped || (retryTimer !== null && !immediate)) return;
    dispose();
    report('retrying');
    // A callback may stop the transport while handling the status transition.
    if (stopped) return;
    retryTimer = setTimeout(start, immediate ? 0 : delay(retryAttempt++));
  }
  function reconnectSignaling(token, instance) {
    if (!current(token, instance) || !signalingDown) return;
    clearTimeout(signalTimer);
    signalTimer = null;
    if (instance.destroyed) return retry();
    try { instance.reconnect(); } catch { /* Retry signaling without closing data. */ }
    if (current(token, instance) && signalingDown) {
      signalTimer = setTimeout(() => reconnectSignaling(token, instance), delay(signalAttempt++));
    }
  }
  function start() {
    if (stopped) return;
    retryTimer = null;
    const token = ++generation;
    let instance;
    try { instance = host ? new Peer(roomId, options) : new Peer(options); }
    catch { retry(); return; }
    peer = instance;
    const isCurrent = () => current(token, instance);
    timeoutTimer = setTimeout(() => { if (isCurrent() && !connected) retry(); }, timeoutMs);

    instance.on('open', () => {
      if (!isCurrent()) return;
      signalingDown = false;
      signalAttempt = 0;
      clearTimeout(signalTimer);
      signalTimer = null;
      // PeerJS emits open again after reconnecting its signaling socket.
      if (opened) return;
      opened = true;
      if (host) {
        connected = true;
        retryAttempt = 0;
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
        report('connected');
        return;
      }
      let next;
      try { next = instance.connect(roomId, { reliable: true }); }
      catch { retry(); return; }
      if (!isCurrent()) { try { next?.close(); } catch {} return; }
      connection = next;
      let dataOpened = false;
      const active = () => isCurrent() && connection === next;
      next.on('data', message => { if (active()) onData(message); });
      next.on('close', () => { if (active()) retry(); });
      next.on('error', () => { if (active()) retry(); });
      next.on('open', () => {
        if (!active() || dataOpened) return;
        dataOpened = true;
        // The caller can send its join/restore handshake as soon as data opens.
        onOpen();
      });
    });
    instance.on('connection', next => {
      if (!isCurrent() || !host) {
        try { next.close(); } catch {}
        return;
      }
      onConnection(next, isCurrent);
    });
    instance.on('disconnected', () => {
      if (!isCurrent() || signalingDown) return;
      signalingDown = true;
      signalAttempt = 0;
      reconnectSignaling(token, instance);
    });
    instance.on('error', error => {
      if (!isCurrent()) return;
      const signalingError = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(error?.type);
      if (opened && !instance.destroyed && signalingError) {
        if (!signalingDown) {
          signalingDown = true;
          signalAttempt = 0;
          reconnectSignaling(token, instance);
        }
        return;
      }
      retry();
    });
    instance.on('close', () => { if (isCurrent()) retry(); });
  }

  report('connecting');
  start();
  return {
    send(message) {
      if (stopped || host || !connection?.open) return false;
      try { connection.send(message); return true; }
      catch { retry(); return false; }
    },
    ready() {
      if (stopped || host || !connection?.open || connected) return;
      connected = true;
      retryAttempt = 0;
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
      report('connected');
    },
    stop() {
      if (stopped) return;
      stopped = true;
      dispose();
    },
    wake() {
      if (!stopped && !connected) retry(true);
    },
  };
}
