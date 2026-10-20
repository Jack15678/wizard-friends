// Original engraved illustrations shared by the HTML hand and WebGL card faces.
const themes = {
  blue: { ink: '#80cfdf', dark: '#123545', name: 'FROST', glyph: '❄' },
  red: { ink: '#efaa78', dark: '#552b29', name: 'EMBER', glyph: '♜' },
  green: { ink: '#a6c4a1', dark: '#233e35', name: 'GROVE', glyph: '❧' },
  yellow: { ink: '#efd18e', dark: '#51452b', name: 'ASTRAL', glyph: '✧' },
  wizard: { ink: '#ead396', dark: '#35304d', name: 'THE ORACLE', glyph: '✦' },
  jester: { ink: '#c7b0d7', dark: '#3c2844', name: 'THE FOOL', glyph: '☾' },
};
const cache = new Map();
function engraving(kind, ink, dark) {
  const scenery = `<circle cx="160" cy="163" r="72" fill="none" stroke="${ink}" opacity=".3"/><circle cx="160" cy="163" r="62" fill="none" stroke="${ink}" opacity=".15"/>`;
  const drawings = {
    blue: `<path d="M76 281 126 174 151 218 183 115 248 281Z" fill="${ink}" opacity=".23"/><path d="m183 115-32 103 25-18 12 20 7-30 20 19Z" fill="${ink}" opacity=".8"/><path d="m126 174-22 48 20-10 13 14 14-8Z" fill="${ink}" opacity=".6"/><path d="M80 288Q160 270 240 288M85 301Q160 283 235 301M99 312Q160 300 221 312" fill="none" stroke="${ink}"/><path d="M160 65v58m-25-43 50 29m-50 0 50-29" stroke="${ink}" stroke-width="2"/><circle cx="160" cy="94" r="8" fill="${ink}"/>`,
    red: `<path d="M160 294C91 290 83 234 109 197c-2 32 18 30 23 13-18-56 27-72 27-119 61 61 16 89 40 107 8-9 10-25 5-36 66 70 21 126-44 132Z" fill="${ink}" opacity=".6"/><path d="M160 284c-43-4-41-38-22-59-1 18 13 24 19 8-6-30 16-40 15-63 35 37 2 50 20 69 5 24-7 41-32 45Z" fill="#f8ddb3"/><path d="m101 300 118 18m-115 0 112-18" stroke="${ink}" stroke-width="9"/><path d="m78 157 5-13m151 2 8 10m-40-71 7-16m-96 29-4-14" stroke="${ink}" stroke-width="2"/>`,
    green: `<path d="M160 303V152m0 78-47-42m47 13 43-46m-43 111 57-47m-57-46-28-30" stroke="${ink}" stroke-width="6" fill="none"/><path d="M158 211C90 214 87 164 87 147c41 3 68 22 71 64Zm5-22c2-60 30-69 63-81 5 42-13 73-63 81Zm0 77c26-57 57-63 81-61-4 49-33 66-81 61Zm-8-96c-40-22-50-52-27-83 29 19 36 47 27 83Z" fill="${ink}" opacity=".65"/><path d="m160 297-35 23m35-23 34 23m-34-23v28" stroke="${ink}" stroke-width="3"/>`,
    yellow: `<circle cx="160" cy="192" r="54" stroke="${ink}" stroke-width="2" fill="none"/><ellipse cx="160" cy="192" rx="86" ry="25" transform="rotate(-35 160 192)" stroke="${ink}" stroke-width="2" fill="none"/><ellipse cx="160" cy="192" rx="86" ry="25" transform="rotate(35 160 192)" stroke="${ink}" fill="none"/><path d="m160 114 16 60 57 18-57 17-16 62-17-62-57-17 57-18Z" fill="${ink}" opacity=".82"/><circle cx="160" cy="192" r="13" fill="${dark}"/><path d="M160 277v36m-35 7h70m-23-7h-24" stroke="${ink}" stroke-width="3"/><circle cx="228" cy="143" r="7" fill="${ink}"/><circle cx="91" cy="238" r="5" fill="${ink}"/>`,
    wizard: `<path d="m103 289 14-89 43-97 43 97 14 89-57 23Z" fill="${ink}" opacity=".3"/><path d="m113 200 47-97 48 99-48-25Z" fill="${dark}" stroke="${ink}" stroke-width="2"/><path d="M132 202q28 29 56 0l-28 70Z" fill="${ink}" opacity=".75"/><path d="m146 215 14 5 14-5" stroke="#fff7ca" stroke-width="3"/><path d="m110 228-30 43m130-43 30 43" stroke="${ink}" stroke-width="6"/><path d="M235 286V137" stroke="${ink}" stroke-width="4"/><path d="m235 111 9 17-9 17-9-17Z" fill="${ink}"/><circle cx="160" cy="91" r="20" fill="none" stroke="${ink}"/><path d="M160 58v12m-33 21h12m42 0h12" stroke="${ink}" stroke-width="2"/>`,
    jester: `<path d="M101 183q-7-59-30-68 65-9 80 61 9-73 47-85-7 43-19 86 51-38 74-12-34 12-43 33Z" fill="${ink}" opacity=".7"/><circle cx="71" cy="115" r="7" fill="${ink}"/><circle cx="198" cy="91" r="7" fill="${ink}"/><circle cx="253" cy="165" r="7" fill="${ink}"/><path d="M102 183q58-21 108 15l-15 62-35 29-38-31Z" fill="${ink}" opacity=".85"/><path d="m119 207 28 11-23 8Zm54 11 27-11-5 19Z" fill="${dark}"/><path d="M136 250q25 21 48-3" stroke="${dark}" stroke-width="5" fill="none"/><path d="m112 272 12 33 37-16 31 19 17-34" stroke="${ink}" stroke-width="3" fill="none"/>`,
  };
  return scenery + drawings[kind];
}
export function cardImage(card) {
  const kind = card.suit || card.kind;
  const t = themes[kind] || themes.wizard;
  const rank = card.kind === 'number' ? card.rank : card.kind === 'jester' ? 'J' : 'W';
  const key = `${kind}-${rank}`;
  if (cache.has(key)) return cache.get(key);
  const stars = Array.from({ length: 18 }, (_, i) => `<circle cx="${68 + (i * 73 % 186)}" cy="${78 + (i * 43 % 235)}" r="${i % 3 === 0 ? 1.5 : .7}" fill="${t.ink}" opacity=".55"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480" viewBox="0 0 320 480">
  <defs><linearGradient id="bg" x2=".8" y2="1"><stop stop-color="${t.dark}"/><stop offset="1" stop-color="#121817"/></linearGradient><radialGradient id="halo"><stop stop-color="${t.ink}" stop-opacity=".2"/><stop offset="1" stop-color="${t.dark}" stop-opacity="0"/></radialGradient></defs>
  <rect x="2" y="2" width="316" height="476" rx="14" fill="#191d1c" stroke="#d4be87" stroke-width="4"/>
  <rect x="13" y="13" width="294" height="454" rx="8" fill="url(#bg)" stroke="${t.ink}" stroke-width="1.4"/>
  <rect x="24" y="24" width="272" height="432" rx="3" fill="none" stroke="${t.ink}" opacity=".35"/>
  <path d="m36 62 26-26m196 0 26 26M36 418l26 26m196 0 26-26" stroke="${t.ink}" fill="none"/>
  <ellipse cx="160" cy="208" rx="128" ry="160" fill="url(#halo)"/>
  ${stars}<g>${engraving(kind,t.ink,t.dark)}</g>
  <path d="M68 344h184M88 350h144" stroke="${t.ink}" opacity=".55"/>
  <text x="160" y="377" text-anchor="middle" font-family="Georgia,serif" font-size="14" letter-spacing="4" fill="${t.ink}">${t.name}</text>
  <path d="m160 394 6 9-6 9-6-9Z" fill="${t.ink}"/>
  <g fill="${t.ink}" font-family="Georgia,serif" font-size="36"><text x="34" y="62">${rank}</text><text x="34" y="86" font-size="18">${t.glyph}</text></g>
  <g transform="rotate(180 160 240)" fill="${t.ink}" font-family="Georgia,serif" font-size="36"><text x="34" y="62">${rank}</text></g>
  </svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}
