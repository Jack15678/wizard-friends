import { connectRelay, relayURL } from './relay-socket.js';

// Every online client speaks to the per-room authority. Private snapshots are
// accepted only once, from an authenticated legacy owner during migration.
export function createRoomTransport({ host, room, token, name = '', automaticName = false,
  spectator = false, snapshot, identities, onStatus = () => {}, onData = () => {},
  onOpen = () => {}, onFatal = () => {}, url = relayURL(`/api/rooms/${room}/ws`), ...socketOptions }) {
  let stopped = false, status;
  const report = next => { if (!stopped && status !== next) { status = next; onStatus(next); } };
  report('connecting');
  const hello = { type: 'hello', version: 2, host, token, name, automaticName, spectator,
    ...(host && snapshot ? { snapshot, identities } : {}) };
  const relay = connectRelay({ ...socketOptions, url, hello,
    onDisconnect() { report('retrying'); }, onFatal,
    onMessage(message) {
      if (message.type === 'ready') {
        // A successful migration is never uploaded again during reconnect.
        delete hello.snapshot; delete hello.identities;
        report('connected'); onOpen();
      }
      else if (message.type === 'data') onData(message.data);
    },
  });
  return {
    send(data) { return !stopped && relay.send({ type: 'send', data }); },
    ready() { report('connected'); },
    advertise() {},
    closeRoom() { return relay.send({ type: 'send', data: { type: 'dissolve' } }); },
    stop() { stopped = true; relay.stop(); },
    wake() { relay.wake(); },
  };
}
