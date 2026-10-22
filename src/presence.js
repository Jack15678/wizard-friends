import { connectRelay, relayURL } from './relay-socket.js';
import { publicRooms } from './public-room.js';
export function createPresence({ visitor, onChange = () => {}, url = relayURL('/api/presence'), ...options }) {
  onChange({ count: null, status: 'connecting', rooms: [] });
  return connectRelay({ ...options, url, hello: { type: 'hello', visitor },
    onDisconnect: () => onChange({ count: null, status: 'unavailable', rooms: [] }),
    onMessage(message) {
      if (message.type === 'directory' && Number.isSafeInteger(message.count) && message.count >= 0) {
        onChange({ count: message.count, status: 'online', rooms: publicRooms(message.rooms) });
      }
    },
  });
}
