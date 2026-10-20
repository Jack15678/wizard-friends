// A separate, elected PeerJS coordinator counts live browser connections.
// No names, room codes, hands, or game messages pass through this channel.
export function createPresence({ Peer, room, visitor, options = {}, onChange,
  tickMs = 10000, ttlMs = 90000, retryMs = 2500, timeoutMs = 20000 }) {
  let peer, timer, deadline, retry, stopped = false, generation = 0;
  const report = (count, status) => onChange({ count, status });
  function clear() {
    generation++;
    clearInterval(timer); clearTimeout(deadline); clearTimeout(retry);
    peer?.destroy();
  }
  function restart() {
    if (stopped) return;
    clear();
    report(null, 'unavailable');
    retry = setTimeout(() => start(true), retryMs + Math.random() * retryMs);
  }
  function start(claim) {
    if (stopped) return;
    clear();
    const gen = generation;
    const current = () => !stopped && generation === gen;
    peer = claim ? new Peer(room, options) : new Peer(options);
    const p = peer;
    deadline = setTimeout(() => { if (current()) restart(); }, timeoutMs);
    p.on('error', err => {
      if (!current()) return;
      if (claim && err.type === 'unavailable-id') start(false);
      else restart();
    });
    p.on('disconnected', () => { if (current()) restart(); });
    p.on('close', () => { if (current()) restart(); });
    if (claim) {
      const members = new Map();
      const publish = () => {
        if (!current()) return;
        const ids = new Set([visitor]);
        for (const [conn, member] of members) {
          if (!conn.open || Date.now() - member.seen > ttlMs) {
            members.delete(conn); conn.close();
          } else if (member.id) ids.add(member.id);
        }
        const count = ids.size;
        report(count, 'online');
        for (const [conn, member] of members) {
          if (member.id && conn.open) conn.send({ type: 'count', count });
        }
      };
      p.on('open', () => {
        if (!current()) return;
        clearTimeout(deadline); publish();
        timer = setInterval(publish, tickMs);
      });
      p.on('connection', conn => {
        if (!current()) return conn.close();
        members.set(conn, { id: null, seen: Date.now() });
        conn.on('data', msg => {
          if (!current() || msg?.type !== 'present' ||
              typeof msg.visitor !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(msg.visitor)) return;
          members.set(conn, { id: msg.visitor, seen: Date.now() });
          publish();
        });
        conn.on('close', () => { members.delete(conn); publish(); });
        conn.on('error', () => { members.delete(conn); conn.close(); publish(); });
      });
    } else {
      p.on('open', () => {
        if (!current()) return;
        const conn = p.connect(room, { reliable: true });
        let lastSeen = Date.now();
        conn.on('open', () => {
          if (!current()) return;
          conn.send({ type: 'present', visitor });
          timer = setInterval(() => {
            if (!current()) return;
            if (Date.now() - lastSeen > ttlMs || !conn.open) return restart();
            conn.send({ type: 'present', visitor });
          }, tickMs);
        });
        conn.on('data', msg => {
          if (!current() || msg?.type !== 'count' ||
              !Number.isSafeInteger(msg.count) || msg.count < 1) return;
          clearTimeout(deadline); lastSeen = Date.now();
          report(msg.count, 'online');
        });
        conn.on('close', () => { if (current()) restart(); });
        conn.on('error', () => { if (current()) restart(); });
      });
    }
  }
  report(null, 'connecting');
  start(true);
  return { stop() { stopped = true; clear(); } };
}

export function presenceRoom(location) {
  // Separate local previews, forks, and deployed sites.
  let hash = 2166136261;
  for (const c of location.origin + location.pathname.replace(/index\.html$/, '')) {
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  }
  return `wizard-presence-v1-${(hash >>> 0).toString(36)}`;
}
