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
  if (saved.authoritative === true) return roomPattern.test(saved.room) && typeof saved.me === 'string' && saved.me.length > 0 && !saved.game && !saved.identities;
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

function lifecycleView(life) {
  if (!life || typeof life !== 'object') return undefined;
  const clean = {};
  for (const key of ['paused','hostOffline','closeAfterRound','closed','reconnecting']) if (typeof life[key] === 'boolean') clean[key] = life[key];
  for (const key of ['retentionDeadline','retentionMs','resultsDeadline','remainingMs']) if (life[key] === null || Number.isFinite(life[key])) clean[key] = life[key];
  if (typeof life.pauseReason === 'string') clean.pauseReason = life.pauseReason.slice(0,300);
  if (Array.isArray(life.resultsConfirmed)) clean.resultsConfirmed = life.resultsConfirmed.filter(id=>typeof id==='string');
  const vote=life.continuationVote;
  clean.continuationVote = vote && Number.isFinite(vote.deadline) ? {deadline:vote.deadline,voters:(vote.voters||[]).filter(id=>typeof id==='string'),accepted:(vote.accepted||[]).filter(id=>typeof id==='string')} : null;
  return clean;
}
function withLifecycle(view, source) {
  const lifecycle=lifecycleView(source.lifecycle);
  return lifecycle ? {...view,lifecycle} : view;
}
export function sanitizeClientView(source, me, spectator = false) {
  if (spectator) return withLifecycle(spectatorView(source),source);
  const state = source;
  const full = state.players.every(player => Array.isArray(player.hand));
  if (full && (!state.vote || state.vote.ballots)) return withLifecycle(viewFor(state, me),state);
  const visible = viewFor({ ...state,
    options:{...state.options,foresight:seesOthers(state)},
    players: state.players.map(player => ({...player,hand:player.hand || []})),
    vote: state.vote ? {...state.vote,ballots:{}} : null,
  }, me);
  visible.options.foresight=state.options?.foresight===true;
  visible.foresightActive=seesOthers(state);
  visible.players = visible.players.map((player, i) => ({...player,
    count: Array.isArray(state.players[i].hand) ? state.players[i].hand.length : Math.max(0,Number(state.players[i].count) || 0),
    bidSubmitted: state.players[i].bidSubmitted === true,
  }));
  if (state.vote) visible.vote = {
    ...visible.vote,
    submitted: (state.vote.submitted || []).filter(id => state.players.some(p => p.id === id)),
    ownChoices: state.vote.ownChoices && typeof state.vote.ownChoices === 'object' ?
      Object.fromEntries(Object.entries(state.vote.ownChoices).filter(([key,value]) => visible.vote.pending[key]?.includes(value))) : null,
  };
  visible.canBid = state.canBid === true;
  visible.bids = (state.bids || []).filter(n => Number.isInteger(n) && n >= 0 && n <= visible.cardsPerRound);
  return withLifecycle(visible,state);
}

export function saveRoomSession(storage, saved) {
  try {
    // Guests retain their permitted view, including others' revealed cards during foresight.
    const record = { version: 1, role: saved.role, room: saved.room, me: saved.me };
    if (saved.authoritative === true) {
      record.authoritative = true;
      if (saved.state) record.state = sanitizeClientView(saved.state, saved.me, saved.role === 'spectator');
    } else if (saved.role === 'spectator') {
      Object.assign(record, spectatorSession(saved));
    } else if (saved.role === 'guest') {
      if (saved.state) record.state=sanitizeClientView(saved.state,saved.me);
    } else {
      record.game = saved.game;
      record.identities = saved.identities;
      for (const key of ['leftAt','remainingMs','paused']) if (Object.hasOwn(saved,key)) record[key] = saved[key];
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
        if (saved?.version === 1 && saved.authoritative === true) {
          const clean = {version:1,role:saved.role,room:saved.room,me:saved.me,authoritative:true};
          if (saved.state) clean.state = sanitizeClientView(saved.state,saved.me,saved.role === 'spectator');
          saved = clean;
        } else if (saved?.version === 1 && saved.role === 'spectator') saved = spectatorSession(saved);
        else if (saved?.version === 1 && saved.role === 'guest') {
          const clean={version:1,role:'guest',room:saved.room,me:saved.me};
          if(saved.state)clean.state=sanitizeClientView(saved.state,saved.me);
          saved=clean;
        }
        if (saved?.role === 'practice' && saved.leftAt != null && Date.now()-saved.leftAt >= 10*60*1000) saved = null;
      } catch { saved = null; }
      if (!validSession(saved)) {
        storage.removeItem(ROOM_SESSION_KEY);
        saved = null;
      } else if (saved.authoritative === true || ['guest','spectator'].includes(saved.role)) {
        // Remove private fields from historical raw caches too, not just the
        // object returned to the caller. Preserve unaccepted legacy host saves.
        try { storage.setItem(ROOM_SESSION_KEY,JSON.stringify(saved)); } catch {}
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
