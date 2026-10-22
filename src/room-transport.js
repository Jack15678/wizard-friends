import { connectRelay, relayURL } from './relay-socket.js';

// The host still owns admission and private views. IDs identify relay-assigned
// sockets, never client-chosen routing targets.
export function createRoomTransport({ host, room, token, onStatus = () => {},
  onData = () => {}, onOpen = () => {}, onConnection = () => {}, onFatal = () => {},
  url = relayURL(`/api/rooms/${room}/ws`), ...socketOptions }) {
  const guests = new Map();
  let stopped = false, connected = false, status, advertisement = null;
  function report(next) {
    if (!stopped && status !== next) { status = next; onStatus(next); }
  }
  function remove(id) {
    const conn = guests.get(id);
    if (!conn) return;
    conn.open = false; conn.emit('close'); guests.delete(id);
  }
  function add(id) {
    if (guests.has(id)) return;
    const listeners = new Map();
    const conn = {
      open: true,
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); },
      emit(event, data) { for (const fn of listeners.get(event) || []) fn(data); },
      send(data) {
        if (!conn.open || !relay.send({ type: 'send', id, data })) throw new Error('连接已中断');
      },
      close() { if (conn.open) { relay.send({ type: 'disconnect', id }); remove(id); } },
    };
    guests.set(id, conn);
    onConnection(conn, () => !stopped && guests.get(id) === conn);
  }
  report('connecting');
  const relay = connectRelay({ ...socketOptions, url, hello: { type: 'hello', host, token },
    onDisconnect() {
      connected = false;
      for (const id of [...guests.keys()]) remove(id);
      report('retrying');
    },
    onFatal,
    onMessage(message) {
      if (message.type === 'ready') {
        if (host) { connected = true; report('connected'); }
        else onOpen();
      } else if (host && message.type === 'joined') add(message.id);
      else if (host && message.type === 'left') remove(message.id);
      else if (message.type === 'data') {
        if (host) guests.get(message.id)?.emit('data', message.data);
        else onData(message.data);
      }
    },
  });
  const publishTimer = setInterval(() => {
    if (host && connected) relay.send({ type: 'advertise', room: advertisement });
  }, 30000);
  return {
    send(data) { return !host && relay.send({ type: 'send', data }); },
    ready() { if (!host && !stopped) { connected = true; report('connected'); } },
    advertise(value) { advertisement = value; if (host && connected) relay.send({ type: 'advertise', room: value }); },
    closeRoom() { if (host) relay.send({ type: 'close-room' }); },
    stop() { stopped = true; clearInterval(publishTimer); relay.stop(); for (const id of [...guests.keys()]) remove(id); },
    wake() { relay.wake(); },
  };
}
