// Persistent return handles contain credentials and identity only. Never persist a
// server-authoritative game, filtered hands, or random stream in this store.
export const ROOM_RECOVERY_KEY = 'wizard-room-return-handles';
const roomPattern = /^[A-Z2-9]{8}$/;
const roles = new Set(['host','guest','spectator']);
export function readRoomRecoveries(storage, invitedRoom = '') {
  try {
    const records = JSON.parse(storage.getItem(ROOM_RECOVERY_KEY) || '[]');
    if (!Array.isArray(records)) return [];
    return records.filter(r => r && roomPattern.test(r.room) && roles.has(r.role) &&
      typeof r.me === 'string' && r.me.length > 0 && typeof r.token === 'string' &&
      /^[a-f0-9-]{36}$/.test(r.token) && Number.isFinite(r.updatedAt) &&
      (!invitedRoom || invitedRoom === r.room)).map(({room,role,me,token,updatedAt}) => ({room,role,me,token,updatedAt}))
      .sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,12);
  } catch { return []; }
}
export function saveRoomRecovery(storage, {room,role,me,token}, now = Date.now()) {
  try {
    const record={room,role,me,token,updatedAt:now};
    if (!roomPattern.test(room) || !roles.has(role) || !me || !/^[a-f0-9-]{36}$/.test(token)) return false;
    const records=readRoomRecoveries(storage).filter(r=>r.room!==room || r.token!==token);
    storage.setItem(ROOM_RECOVERY_KEY,JSON.stringify([record,...records].slice(0,12)));return true;
  } catch { return false; }
}
export function removeRoomRecovery(storage, room, token) {
  try { storage.setItem(ROOM_RECOVERY_KEY,JSON.stringify(readRoomRecoveries(storage).filter(r=>r.room!==room || r.token!==token))); } catch {}
}
