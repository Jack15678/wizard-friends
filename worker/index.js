import { publicRoom, publicRooms } from '../src/public-room.js';
import { RoomAuthority, RECONNECT_GRACE_MS } from './room-authority.js';

const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const MAX_FRAME = 256 * 1024;
const DIRECTORY_TTL = 90000;
const json = (value, status = 200) => Response.json(value, { status });
const send = (ws, value) => { try { ws.send(JSON.stringify(value)); } catch {} };
const close = (ws, code = 1000, reason = '') => { try { ws.close(code, reason); } catch {} };
const attachment = ws => ws.deserializeAttachment() || {};
async function fingerprint(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
function accept(ctx, metadata) {
  const pair = new WebSocketPair();
  ctx.acceptWebSocket(pair[1]);
  pair[1].serializeAttachment({ ...metadata, created: Date.now() });
  // Unauthenticated sockets must not occupy room slots indefinitely.
  setTimeout(() => { if (!attachment(pair[1]).authenticated) close(pair[1], 1008, 'Authentication timeout'); }, 10000);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
function parse(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME || new TextEncoder().encode(raw).length > MAX_FRAME) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/health') return json({ transport: 'cloudflare-websocket', version: 2 });
    const origin = request.headers.get('Origin');
    const allowed = new Set([url.origin, ...(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim())]);
    if (['localhost', '127.0.0.1'].includes(url.hostname) && origin) {
      try { if (['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) allowed.add(origin); } catch {}
    }
    if (origin && !allowed.has(origin)) return json({ error: 'Origin not allowed' }, 403);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
    if (url.pathname === '/api/presence') return env.DIRECTORY.getByName('public').fetch(request);
    const match = /^\/api\/rooms\/([A-Z2-9]{8})\/ws$/.exec(url.pathname);
    if (match) return env.ROOMS.getByName(match[1]).fetch(request);
    return json({ error: 'Not found' }, 404);
  },
};

export class RoomRelay {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.queue = Promise.resolve();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.initialized = ctx.blockConcurrencyWhile(async () => {
      const record = await ctx.storage.get('authority');
      this.authority = record ? new RoomAuthority(record) : null;
      if (this.authority && !this.authority.closed) {
        const connected = new Set(this.sockets().map(ws => attachment(ws).playerId));
        for (const p of this.authority.game.players) if (!p.bot && p.online && !connected.has(p.id)) this.authority.disconnect(p.id);
      }
    });
  }
  async serial(callback) {
    await this.initialized;
    const result = this.queue.then(callback);
    this.queue = result.catch(() => {});
    return result;
  }
  sockets() { return this.ctx.getWebSockets().filter(ws => attachment(ws).authenticated && !attachment(ws).removed); }
  host() { return this.sockets().find(ws => attachment(ws).host); }
  async fetch(request) {
    await this.initialized;
    // Closed links still complete a handshake so clients receive a terminal
    // fatal message rather than retrying an opaque failed WebSocket upgrade.
    if (this.ctx.getWebSockets().filter(ws => !attachment(ws).removed).length >= 64) return json({ error: 'Room full' }, 429);
    const room = new URL(request.url).pathname.split('/')[3];
    return accept(this.ctx, { room, id: crypto.randomUUID() });
  }
  async advertise(room, descriptor) {
    return this.env.DIRECTORY.getByName('public').fetch('https://directory/update', {
      method: 'POST', body: JSON.stringify({ room, descriptor }),
    });
  }
  remove(ws, code = 1000) {
    ws.serializeAttachment({ ...attachment(ws), removed: true }); close(ws, code);
  }
  advance(now = Date.now()) {
    if (!this.authority) return;
    // Auto-response timestamps survive hibernation and measure actual heartbeat
    // traffic. A suspended or half-open browser must not retain host presence.
    for (const ws of this.sockets()) {
      const info = attachment(ws);
      const heartbeat = this.ctx.getWebSocketAutoResponseTimestamp?.(ws)?.getTime?.() || 0;
      if (now - Math.max(info.lastSeen || info.created || now, heartbeat) > 75000) {
        this.remove(ws, 1012);
        if (!this.sockets().some(other => attachment(other).playerId === info.playerId)) this.authority.disconnect(info.playerId, now);
      }
    }
    const expected = this.authority.record.alarmAt;
    if (expected && now - expected > 15000) {
      if (this.authority.game.phase === 'play' && Number.isFinite(this.authority.game.turnDeadline)) {
        this.authority.game.turnDeadline = Math.max(now + 8000, this.authority.game.turnDeadline + now - expected);
      }
      if (this.authority.record.task) this.authority.record.task.at = Math.max(now + 450, this.authority.record.task.at + now - expected);
      this.authority.record.alarmAt = now + 8000;
    }
    this.authority.tick(now);
  }
  async authorize(ws, message) {
    const info = attachment(ws);
    if (message?.type !== 'hello' || typeof message.host !== 'boolean' || !uuid(message.token)) return close(ws, 1008);
    if (message.version !== 2) {
      send(ws, { type: 'fatal', message: '房间服务已更新，请在原标签页刷新后恢复旧存档；请所有成员一起更新页面。' }); return close(ws, 1008);
    }
    if (await this.ctx.storage.get('closed') || this.authority?.closed) {
      send(ws, { type: 'fatal', message: '房间已关闭，旧链接不能重新开启牌局。' }); return close(ws, 1000);
    }
    const hash = await fingerprint(message.token);
    if (message.host) {
      const owner = await this.ctx.storage.get('owner');
      if (owner && owner !== hash) {
        send(ws, { type: 'fatal', message: '该房间属于另一位房主，请返回首页创建新房间。' }); return close(ws, 1008);
      }
      if (!this.authority) {
        this.authority = new RoomAuthority();
        if (message.snapshot) {
          if (!owner) {
            send(ws, { type: 'fatal', message: '新房间必须由服务端创建牌局，不能导入未经登记的客户端牌局。' }); this.authority = null; return close(ws, 1008);
          }
          const source = message.snapshot;
          if (!Array.isArray(source.players) || source.players.length < 1 || source.players.length > 6 ||
              !source.players.every(p => typeof p.id === 'string' && Array.isArray(p.hand)) ||
              new Set(source.players.map(p => p.id)).size !== source.players.length || !Array.isArray(source.history)) {
            send(ws, { type: 'fatal', message: '旧牌局存档格式无效，未覆盖原始浏览器存档。' }); this.authority = null; return close(ws, 1008);
          }
          const migrated = structuredClone(source);
          // Legacy browsers were authoritative and may supply a predictable
          // stream. Preserve already-dealt cards, but seed future deals here.
          delete migrated.randomState;
          this.authority.record.game = migrated;
          this.authority = new RoomAuthority(this.authority.record);
          this.authority.record.hostId = source.players[0].id;
          for (const [secret, id] of Object.entries(message.identities || {})) {
            if (uuid(secret) && source.players.some(p => p.id === id)) this.authority.record.identities[await fingerprint(secret)] = id;
          }
          this.authority.record.identities[hash] = source.players[0].id;
          const recoveryNow = Date.now();
          if (this.authority.game.phase === 'play' && (!Number.isFinite(this.authority.game.turnDeadline) || this.authority.game.turnDeadline <= recoveryNow)) this.authority.game.turnDeadline = recoveryNow + RECONNECT_GRACE_MS;
          this.authority.game.players.forEach(p => {
            p.online = !!p.bot;
            if (!p.bot) this.authority.record.reconnectUntil[p.id] = recoveryNow + RECONNECT_GRACE_MS;
          });
          this.authority.syncClock(recoveryNow);
        } else if (owner) {
          send(ws, { type: 'fatal', message: '此旧房间需要原房主浏览器中的完整存档才能迁移，未创建新牌局。' }); this.authority = null; return close(ws, 1008);
        }
      }
    } else if (!this.authority) return close(ws, 1013, 'Waiting for host');
    try {
      this.advance();
      const spectators = new Set(this.sockets().filter(other => attachment(other).spectator).map(other => attachment(other).playerId));
      if (message.spectator && spectators.size >= 50 && !spectators.has(`spectator:${hash}`)) throw new Error('观战人数已满。');
      const identity = this.authority.join(hash, {
        host: message.host, name: message.name || '', automaticName: message.automaticName === true || !message.name,
        spectator: !message.host && message.spectator === true,
      });
      if (message.host) await this.ctx.storage.put({ owner: hash, room: info.room });
      ws.serializeAttachment({ ...info, authenticated: true, playerId: identity.id, host: identity.host, spectator: identity.spectator, lastSeen: Date.now() });
      send(ws, { type: 'ready', authority: true });
      await this.persistAndPublish(info.room);
    } catch (error) { send(ws, { type: 'fatal', message: error.message }); close(ws, 1008); }
  }
  async persistAndPublish(room) {
    if (!this.authority) return;
    const now = Date.now();
    this.authority.record.savedAt = now;
    const g = this.authority.game;
    const activeRoom = publicRoom({ room, hostName: g.players[0]?.name, players: g.players.length,
      round: g.round, maxRounds: g.maxRounds, phase: g.phase, spectators: 0 });
    const next = this.authority.nextAlarm(now);
    const alarm = activeRoom || this.sockets().length ? Math.min(next ?? Infinity, now + 30000) : next;
    this.authority.record.alarmAt = alarm;
    await this.ctx.storage.put('authority', this.authority.record);
    if (this.authority.closed) {
      await this.ctx.storage.put('closed', true);
      for (const ws of this.sockets()) {
        send(ws, { type: 'fatal', message: this.authority.life.closeReason || '房间已关闭。' }); this.remove(ws);
      }
      await this.advertise(room, null);
      // Keep the tombstone; deleting it would let old links resurrect a closed room.
      await this.ctx.storage.put('authority', { ...this.authority.record, game: { ...this.authority.game, players: [], trick: [], chat: [] }, identities: {} });
      if (this.ctx.storage.deleteAlarm) await this.ctx.storage.deleteAlarm();
      return;
    }
    if (alarm) await this.ctx.storage.setAlarm(alarm);
    else if (this.ctx.storage.deleteAlarm) await this.ctx.storage.deleteAlarm();
    const sockets = this.sockets();
    const spectatorCount = new Set(sockets.filter(ws => attachment(ws).spectator).map(ws => attachment(ws).playerId)).size;
    for (const ws of sockets) {
      const info = attachment(ws);
      send(ws, { type: 'data', data: {
        type: 'state', state: this.authority.view({ id: info.playerId, spectator: info.spectator }, spectatorCount, now),
        me: info.playerId, isHost: info.host, serverNow: now, serverTime: now,
      } });
    }
    const descriptor = publicRoom({ room, hostName: g.players[0]?.name, players: g.players.length,
      round: g.round, maxRounds: g.maxRounds, phase: g.phase, spectators: spectatorCount });
    await this.advertise(room, descriptor);
    // The directory expires stale entries at 90s. Healthy authoritative rooms
    // refresh their descriptor without requiring a browser-host heartbeat.

  }
  webSocketMessage(ws, raw) {
    return this.serial(async () => {
      const message = parse(raw);
      if (!message || typeof message !== 'object') return close(ws, 1009);
      const info = attachment(ws);
      if (info.removed) return;
      if (!info.authenticated) return this.authorize(ws, message);
      const now = Date.now();
      const count = now - (info.windowStart || 0) < 1000 ? (info.count || 0) + 1 : 1;
      ws.serializeAttachment({ ...info, count, lastSeen: now, windowStart: count === 1 ? now : info.windowStart });
      if (count > 40) return close(ws, 1008, 'Too many messages');
      this.advance(now);
      if (!this.authority.closed) {
        const data = message.type === 'send' ? message.data : message.type === 'close-room' ? { type: 'dissolve' } : null;
        const requestId = data?.type === 'action' && typeof data.requestId === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(data.requestId) ? data.requestId : null;
        try {
          if (!data || typeof data !== 'object') throw new Error('无效房间操作。');
          if (data.type === 'leave') {
            this.remove(ws);
            if (!this.sockets().some(other => attachment(other).playerId === info.playerId)) this.authority.disconnect(info.playerId, now);
          } else {
            this.authority.handle({ id: info.playerId, spectator: info.spectator }, data, now);
            if (data.type === 'remove') for (const other of this.sockets()) if (attachment(other).playerId === data.id) {
              send(other, { type: 'data', data: { type: 'removed' } }); this.remove(other);
            }
          }
        } catch (error) { send(ws, { type: 'data', data: { type: 'error', message: error.message, ...(requestId ? { requestId } : {}) } }); }
      }
      await this.persistAndPublish(info.room);
    });
  }
  webSocketClose(ws) {
    return this.serial(async () => {
      const info = attachment(ws);
      if (!info.authenticated || info.removed) return;
      this.remove(ws);
      if (!this.sockets().some(other => attachment(other).playerId === info.playerId)) this.authority?.disconnect(info.playerId);
      await this.persistAndPublish(info.room);
    });
  }
  webSocketError(ws) { return this.webSocketClose(ws); }
  alarm() {
    return this.serial(async () => {
      if (!this.authority) return;
      const now = Date.now();
      this.advance(now);
      const room = await this.ctx.storage.get('room');
      await this.persistAndPublish(room);
    });
  }
}

export class RoomDirectory {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request) {
    if (new URL(request.url).pathname === '/update' && request.method === 'POST') {
      const { room, descriptor } = await request.json();
      if (typeof room !== 'string' || !/^[A-Z2-9]{8}$/.test(room)) return json({}, 400);
      const value = publicRoom(descriptor);
      if (value?.room === room) {
        await this.ctx.storage.put(`room:${room}`, { value, expires: Date.now() + DIRECTORY_TTL });
      } else await this.ctx.storage.delete(`room:${room}`);
      await this.publish(); return json({ ok: true });
    }
    if (this.ctx.getWebSockets().length >= 1000) return json({}, 429);
    return accept(this.ctx, {});
  }
  async publish() {
    const sockets = this.ctx.getWebSockets().filter(ws => attachment(ws).authenticated && !attachment(ws).removed);
    const entries = await this.ctx.storage.list({ prefix: 'room:' });
    const rooms = [];
    for (const [key, entry] of entries) {
      if (entry.expires > Date.now()) rooms.push(entry.value);
      else await this.ctx.storage.delete(key);
    }
    const count = new Set(sockets.map(ws => attachment(ws).visitor)).size;
    const message = { type: 'directory', count, rooms: publicRooms(rooms) };
    for (const ws of sockets) send(ws, message);
    if (rooms.length) await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
  async webSocketMessage(ws, raw) {
    const message = parse(raw);
    if (!message || message.type !== 'hello' || !uuid(message.visitor) || attachment(ws).authenticated) return close(ws, 1008);
    ws.serializeAttachment({ ...attachment(ws), visitor: message.visitor, authenticated: true });
    send(ws, { type: 'ready' }); await this.publish();
  }
  async webSocketClose(ws) {
    ws.serializeAttachment({ ...attachment(ws), removed: true }); close(ws);
    await this.publish();
  }
  webSocketError(ws) { return this.webSocketClose(ws); }
  alarm() { return this.publish(); }
}
