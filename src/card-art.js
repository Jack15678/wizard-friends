// Shared by HTML hands, the 2D trump card and WebGL textures.
// Vite emits separate, hashed assets; the four copies of each special share art.
export function cardImage(card) {
  const artwork = card.kind === 'number'
    ? `${card.suit}-${String(card.rank).padStart(2, '0')}`
    : card.kind;
  return new URL(`./assets/cards/${artwork}.svg`, import.meta.url).href;
}
