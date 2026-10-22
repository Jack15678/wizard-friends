const phases = new Set(['trump', 'bid', 'play', 'trickEnd', 'roundEnd']);
export function publicRoom(value) {
  if (!value || typeof value.room !== 'string' || !/^[A-Z2-9]{8}$/.test(value.room) ||
      typeof value.hostName !== 'string' || !value.hostName.trim() || [...value.hostName].length > 16 ||
      /[\u0000-\u001f\u007f]/.test(value.hostName) ||
      !Number.isSafeInteger(value.players) || value.players < 3 || value.players > 6 ||
      !Number.isSafeInteger(value.round) || value.round < 1 || value.round > 20 ||
      !Number.isSafeInteger(value.maxRounds) || value.maxRounds < value.round || value.maxRounds > 20 ||
      !phases.has(value.phase) || !Number.isSafeInteger(value.spectators) || value.spectators < 0 || value.spectators > 50) return null;
  const { room, hostName, players, round, maxRounds, phase, spectators } = value;
  return { room, hostName: hostName.trim(), players, round, maxRounds, phase, spectators };
}
export function publicRooms(values) {
  const rooms = new Map();
  if (Array.isArray(values)) for (const value of values.slice(0, 50)) {
    const room = publicRoom(value);
    if (room) rooms.set(room.room, room);
  }
  return [...rooms.values()].sort((a, b) => a.room.localeCompare(b.room));
}
