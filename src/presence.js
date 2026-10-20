// An elected PeerJS coordinator shares browser counts and public room summaries.
// Game state, cards, chat and player identity tokens never use this channel.
const playingPhases = new Set(['trump', 'bid', 'play', 'trickEnd', 'roundEnd']);
function publicRoom(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.room !== 'string' || !/^[A-Z2-9]{8}$/.test(value.room) ||
        typeof value.hostName !== 'string' || value.hostName.length > 32) return null;
    const hostName = value.hostName.trim();
    if (!hostName || [...hostName].length > 16 || /[\u0000-\u001f\u007f]/.test(hostName) ||
        !Number.isSafeInteger(value.players) || value.players < 3 || value.players > 6 ||
        !Number.isSafeInteger(value.round) || value.round < 1 || value.round > 20 ||
        !Number.isSafeInteger(value.maxRounds) || value.maxRounds < value.round || value.maxRounds > 20 ||
        !playingPhases.has(value.phase) ||
        !Number.isSafeInteger(value.spectators) || value.spectators < 0 || value.spectators > 50) return null;
    return { room: value.room, hostName, players: value.players, round: value.round,
      maxRounds: value.maxRounds, phase: value.phase, spectators: value.spectators };
  } catch { return null; }
}
function publicRooms(values) {
  const rooms = new Map();
  if (Array.isArray(values)) for (const value of values.slice(0, 50)) {
    const descriptor = publicRoom(value);
    if (descriptor && !rooms.has(descriptor.room)) rooms.set(descriptor.room, descriptor);
  }
  return [...rooms.values()].sort((a, b) => a.room.localeCompare(b.room));
}

export function createPresence({ Peer, room, visitor, options = {}, onChange = () => {},
  tickMs = 10000, ttlMs = 90000, retryMs = 2500, timeoutMs = 20000 }) {
  let peer, timer, deadline, retry, stopped = false, generation = 0;
  let advertised = null, announce = null, lastReport = '';
  const report = (count, status, rooms = []) => {
    const result = { count, status, rooms: publicRooms(rooms) };
    const signature = JSON.stringify(result);
    if (signature === lastReport) return;
    lastReport = signature;
    onChange(result);
  };
  function clear() {
    generation++;
    clearInterval(timer); clearTimeout(deadline); clearTimeout(retry);
    timer = deadline = retry = null;
    announce = null;
    const previous = peer;
    peer = null;
    try { previous?.destroy(); } catch {}
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
    try { peer = claim ? new Peer(room, options) : new Peer(options); }
    catch { restart(); return; }
    const p = peer;
    let opened = false;
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
      let revision = 0, ownSeen = Date.now(), ownRevision = 0, publishing = false, republish = false;
      const publish = () => {
        if (!current()) return;
        if (publishing) { republish = true; return; }
        publishing = true;
        do {
          republish = false;
          const ids = new Set([visitor]);
          const records = advertised ? [{ room: advertised, seen: ownSeen, revision: ownRevision }] : [];
          for (const [conn, member] of members) {
            // Inbound PeerJS connections may not have opened or joined yet.
            if ((!conn.open && member.id) || Date.now() - member.seen > ttlMs) {
              members.delete(conn);
              try { conn.close(); } catch {}
            } else if (member.id && conn.open) {
              ids.add(member.id);
              if (member.room) records.push({ room: member.room, seen: member.seen, revision: member.revision });
            }
          }
          const directory = new Map();
          records.sort((a, b) => b.seen - a.seen || b.revision - a.revision);
          for (const record of records) {
            if (!directory.has(record.room.room)) directory.set(record.room.room, record.room);
            if (directory.size === 50) break;
          }
          const count = ids.size, rooms = publicRooms([...directory.values()]);
          report(count, 'online', rooms);
          for (const [conn, member] of members) {
            if (!current()) break;
            if (member.id && conn.open) {
              try { conn.send({ type: 'count', count, rooms }); }
              catch {
                members.delete(conn);
                try { conn.close(); } catch {}
                republish = true;
              }
            }
          }
        } while (republish && current());
        publishing = false;
      };
      p.on('open', () => {
        if (!current() || opened) return;
        opened = true;
        announce = () => { ownSeen = Date.now(); ownRevision = ++revision; publish(); };
        clearTimeout(deadline); announce();
        if (!current()) return;
        timer = setInterval(() => { if (current()) announce(); }, tickMs);
      });
      p.on('connection', conn => {
        if (!current()) return conn.close();
        members.set(conn, { id: null, seen: Date.now(), room: null, revision: ++revision });
        conn.on('data', msg => {
          if (!current() || msg?.type !== 'present' ||
              typeof msg.visitor !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(msg.visitor)) return;
          members.set(conn, { id: msg.visitor, seen: Date.now(), room: publicRoom(msg.room), revision: ++revision });
          publish();
        });
        conn.on('close', () => { if (current()) { members.delete(conn); publish(); } });
        conn.on('error', () => {
          if (!current()) return;
          members.delete(conn);
          try { conn.close(); } catch {}
          publish();
        });
      });
    } else {
      p.on('open', () => {
        if (!current() || opened) return;
        opened = true;
        let conn;
        try { conn = p.connect(room, { reliable: true }); }
        catch { restart(); return; }
        let lastSeen = Date.now();
        let connectionOpened = false;
        conn.on('open', () => {
          if (!current() || connectionOpened) return;
          connectionOpened = true;
          const send = () => {
            if (!current()) return;
            if (!conn.open) return restart();
            try { conn.send({ type: 'present', visitor, room: advertised }); }
            catch { restart(); }
          };
          announce = send;
          send();
          if (!current()) return;
          timer = setInterval(() => {
            if (!current()) return;
            if (Date.now() - lastSeen > ttlMs || !conn.open) return restart();
            send();
          }, tickMs);
        });
        conn.on('data', msg => {
          if (!current() || msg?.type !== 'count' ||
              !Number.isSafeInteger(msg.count) || msg.count < 1) return;
          clearTimeout(deadline); lastSeen = Date.now();
          report(msg.count, 'online', msg.rooms);
        });
        conn.on('close', () => { if (current()) restart(); });
        conn.on('error', () => { if (current()) restart(); });
      });
    }
  }
  report(null, 'connecting');
  start(true);
  return {
    advertise(descriptor) {
      if (stopped) return;
      const next = publicRoom(descriptor);
      if (JSON.stringify(next) === JSON.stringify(advertised)) return;
      advertised = next;
      announce?.();
    },
    stop() { if (!stopped) { stopped = true; clear(); } },
  };
}

export function presenceRoom(location) {
  // Separate local previews, forks, and deployed sites.
  let hash = 2166136261;
  for (const c of location.origin + location.pathname.replace(/index\.html$/, '')) {
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  }
  // Older count-only coordinators cannot relay room listings during a rolling update.
  return `wizard-presence-v2-${(hash >>> 0).toString(36)}`;
}
