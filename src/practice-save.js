export const PRACTICE_SAVE_KEY = 'wizard-practice-save';
export const PRACTICE_KEEP_MS = 10 * 60 * 1000;
export function savePractice(storage, saved, now = Date.now(), leaving = false) {
  try {
    const previous = JSON.parse(storage.getItem(PRACTICE_SAVE_KEY) || 'null');
    storage.setItem(PRACTICE_SAVE_KEY, JSON.stringify({ ...saved, practiceVersion: 1,
      leftAt: leaving ? (previous?.leftAt ?? now) : null,
      remainingMs: Number.isFinite(saved.remainingMs) ? saved.remainingMs : Number.isFinite(saved.game?.turnDeadline) ? Math.max(0, saved.game.turnDeadline - now) : null }));
    return true;
  } catch { return false; }
}
export function readPractice(storage, now = Date.now()) {
  try {
    const saved = JSON.parse(storage.getItem(PRACTICE_SAVE_KEY) || 'null');
    if (!saved) return null;
    if (saved.practiceVersion !== 1 || !saved.game?.players?.length || !saved.me ||
      (saved.leftAt != null && now - saved.leftAt >= PRACTICE_KEEP_MS)) {
      storage.removeItem(PRACTICE_SAVE_KEY); return null;
    }
    return saved;
  } catch { return null; }
}
