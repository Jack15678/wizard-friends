export const TRUMP_COLORS = { blue: '#60b8ff', red: '#ff6668', green: '#70d79d', yellow: '#f3cf66', none: '#ffffff' };
export function trumpStyle(state) {
  const suit = Object.hasOwn(TRUMP_COLORS, state.trump) ? state.trump : 'none';
  return { suit, color: TRUMP_COLORS[suit], pending: state.phase === 'trump' };
}
