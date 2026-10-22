import { publicRoom, publicRooms } from '../src/public-room.js';

const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const MAX_FRAME = 256 * 1024;
const ROOM_TTL = 7 * 24 * 60 * 60 * 1000;
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
    if (url.pathname === '/api/health') return json({ transport: 'cloudflare-websocket', version: 1 });
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
    this.ctx = ctx; this.env = env;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  sockets() { return this.ctx.getWebSockets().filter(ws => attachment(ws).authenticated && !attachment(ws).removed); }
  host() { return this.sockets().find(ws => attachment(ws).host); }
  async fetch(request) {
    if (this.ctx.getWebSockets().length >= 64) return json({ error: 'Room full' }, 429);
    const room = new URL(request.url).pathname.split('/')[3];
    return accept(this.ctx, { room, id: crypto.randomUUID() });
  }
  async advertise(room, descriptor) {
    // Internal call: no public endpoint can publish an unauthenticated room.
    return this.env.DIRECTORY.getByName('public').fetch('https://directory/update', {
      method: 'POST', body: JSON.stringify({ room, descriptor }),
    });
  }
  async authorize(ws, message) {
    const info = attachment(ws);
    if (message?.type !== 'hello' || typeof message.host !== 'boolean' || !uuid(message.token)) return close(ws, 1008);
    if (message.host) {
      const hash = await fingerprint(message.token);
      const result = await this.ctx.blockConcurrencyWhile(async () => {
        const owner = await this.ctx.storage.get('owner');
        if (owner && owner !== hash) return '该房间属于另一位房主，请返回首页创建新房间。';
        if (await this.ctx.storage.get('closed')) return '房主已关闭房间，请创建新房间。';
        await this.ctx.storage.put({ owner: hash, room: info.room });
        await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
        // Refresh replaces the old host and all old routing IDs.
        for (const previous of this.sockets()) this.remove(previous, 1012);
        ws.serializeAttachment({ ...info, authenticated: true, host: true });
        return null;
      });
      if (result) { send(ws, { type: 'fatal', message: result }); return close(ws, 1008); }
      send(ws, { type: 'ready' });
    } else {
      if (await this.ctx.storage.get('closed')) {
        send(ws, { type: 'fatal', message: '房主已关闭房间。' }); return close(ws, 1000);
      }
      const host = this.host();
      if (!host) return close(ws, 1013, 'Waiting for host');
      ws.serializeAttachment({ ...info, authenticated: true, host: false });
      send(host, { type: 'joined', id: info.id });
      send(ws, { type: 'ready' });
    }
  }
  remove(ws, code = 1000) {
    ws.serializeAttachment({ ...attachment(ws), removed: true }); close(ws, code);
  }
  async webSocketMessage(ws, raw) {
    const message = parse(raw);
    if (!message || typeof message !== 'object') return close(ws, 1009);
    const info = attachment(ws);
    if (info.removed) return;
    if (!info.authenticated) return this.authorize(ws, message);
    const now = Date.now();
    const count = now - (info.windowStart || 0) < 1000 ? (info.count || 0) + 1 : 1;
    ws.serializeAttachment({ ...info, count, windowStart: count === 1 ? now : info.windowStart });
    if (count > (info.host ? 300 : 40)) return close(ws, 1008, 'Too many messages');
    if (message.type === 'send' && message.data && typeof message.data === 'object') {
      if (info.host) {
        const target = this.sockets().find(other => !attachment(other).host && attachment(other).id === message.id);
        if (target) send(target, { type: 'data', data: message.data });
      } else {
        const host = this.host();
        if (host) send(host, { type: 'data', id: info.id, data: message.data });
      }
    } else if (info.host && message.type === 'disconnect') {
      const target = this.sockets().find(other => !attachment(other).host && attachment(other).id === message.id);
      if (target) this.remove(target);
    } else if (info.host && message.type === 'advertise') {
      const value = publicRoom(message.room);
      await this.advertise(info.room, value?.room === info.room ? value : null);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
    } else if (info.host && message.type === 'close-room') {
      await this.ctx.storage.put('closed', true);
      for (const guest of this.sockets()) if (guest !== ws) {
        send(guest, { type: 'fatal', message: '房主已关闭房间。' }); this.remove(guest);
      }
      await this.advertise(info.room, null);
      this.remove(ws);
    }
  }
  async webSocketClose(ws) {
    const info = attachment(ws);
    if (!info.authenticated || info.removed) return;
    this.remove(ws);
    if (info.host) {
      for (const guest of this.sockets()) this.remove(guest, 1012);
      await this.advertise(info.room, null);
    } else {
      const host = this.host();
      if (host) send(host, { type: 'left', id: info.id });
    }
  }
  webSocketError(ws) { return this.webSocketClose(ws); }
  async alarm() {
    if (this.host()) return this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
    const room = await this.ctx.storage.get('room');
    if (room) await this.advertise(room, null);
    for (const ws of this.ctx.getWebSockets()) this.remove(ws);
    await this.ctx.storage.deleteAll();
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
