import { viewFor, spectatorView } from './game.js';

export const ROOM_SESSION_KEY = 'wizard-room-session';
const roomPattern = /^[A-Z2-9]{8}$/;
const phases = new Set(['lobby', 'rules', 'trump', 'bid', 'play', 'trickEnd', 'roundEnd', 'finished']);
const seesOthers = state => state.foresightActive === true && state.options?.foresight === true &&
  ['trump', 'bid'].includes(state.phase);

function validState(state, me, full, spectator = false) {
  return state && phases.has(state.phase) && Array.isArray(state.players) &&
    state.players.length >= 1 && state.players.length <= 6 &&
    (spectator || state.players.some(player => player.id === me)) &&
    state.players.every(player => {
      const hasHand = !spectator && (full || (seesOthers(state) ? player.id !== me : player.id === me));
      return typeof player.id === 'string' && typeof player.name === 'string' &&
        (hasHand ? Array.isArray(player.hand) : !Object.hasOwn(player, 'hand'));
    }) &&
    Array.isArray(state.trick) && Array.isArray(state.history) && Array.isArray(state.log) &&
    state.options && typeof state.options.short === 'boolean' && typeof state.options.strict === 'boolean';
}

function validSession(saved) {
  if (!saved || saved.version !== 1 || !['host', 'guest', 'practice', 'spectator'].includes(saved.role)) return false;
  if (saved.role === 'spectator') {
    return typeof saved.room === 'string' && roomPattern.test(saved.room) && typeof saved.me === 'string' && saved.me.length > 0 &&
      (!saved.state || (saved.state.spectator === true && validState(saved.state, saved.me, false, true)));
  }
  if (saved.role === 'guest') {
    return roomPattern.test(saved.room) && typeof saved.me === 'string' &&
      (!saved.state || validState(saved.state, saved.me, false));
  }
  return (saved.role === 'practice' || roomPattern.test(saved.room)) &&
    typeof saved.me === 'string' && validState(saved.game, saved.me, true) &&
    saved.game.players[0].id === saved.me && saved.identities && typeof saved.identities === 'object';
}

export function clearRoomSession(storage) {
  for (const key of [ROOM_SESSION_KEY, 'wizard-host', 'wizard-last-room']) {
    try { storage.removeItem(key); } catch {}
  }
}

function spectatorSession(saved) {
  const record = { version: 1, role: 'spectator', room: saved.room, me: saved.me };
  const state = saved.state ?? saved.game;
  if (state) record.state = spectatorView(state);
  return record;
}

export function saveRoomSession(storage, saved) {
  try {
    // Guests retain their permitted view, including others' revealed cards during foresight.
    const record = { version: 1, role: saved.role, room: saved.room, me: saved.me };
    if (saved.role === 'spectator') {
      Object.assign(record, spectatorSession(saved));
    } else if (saved.role === 'guest') {
      if (saved.state) {
        // Also sanitize accidental full-state input through the engine's privacy rules.
        const state = saved.state.players.every(player => Array.isArray(player.hand)) ? viewFor(saved.state, saved.me) : saved.state;
        const othersVisible = seesOthers(state);
        record.state = {
          ...state,
          players: state.players.map(({ hand, ...player }) =>
            (othersVisible ? player.id !== saved.me : player.id === saved.me) ? { ...player, hand } : player),
        };
      }
    } else {
      record.game = saved.game;
      record.identities = saved.identities;
    }
    if (!validSession(record)) return false;
    storage.setItem(ROOM_SESSION_KEY, JSON.stringify(record));
    storage.removeItem('wizard-host');
    storage.removeItem('wizard-last-room');
    return true;
  } catch { return false; }
}

export function readRoomSession(storage, invitedRoom = '') {
  let saved;
  try {
    const raw = storage.getItem(ROOM_SESSION_KEY);
    if (raw) {
      try {
        saved = JSON.parse(raw);
        // Reapply privacy rules to cached public states, including older or tampered storage.
        if (saved?.version === 1 && saved.role === 'spectator') saved = spectatorSession(saved);
      } catch { saved = null; }
      if (!validSession(saved)) {
        storage.removeItem(ROOM_SESSION_KEY);
        saved = null;
      }
    }
    if (!saved) {
      // Upgrade already-open tabs from the previous release without losing their seats.
      try {
        const old = JSON.parse(storage.getItem('wizard-host') || 'null');
        if (old) {
          const candidate = { ...old, version: 1, role: 'host' };
          if (validSession(candidate)) saved = candidate;
          else storage.removeItem('wizard-host');
        }
      } catch { storage.removeItem('wizard-host'); }
      if (!saved) {
        const room = storage.getItem('wizard-last-room') || '';
        if (roomPattern.test(room)) saved = { version: 1, role: 'guest', room, me: '' };
      }
    }
    if (saved && (!invitedRoom || saved.room === invitedRoom)) return saved;
  } catch {}
  return null;
}
