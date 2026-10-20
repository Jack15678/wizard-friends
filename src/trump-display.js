import { cardImage } from './card-art.js';
import { SUIT_NAMES } from './game.js';
import { trumpStyle } from './trump-style.js';

// An original card back, shared by the CSS fallback and the physical WebGL card.
export const CARD_BACK_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480" viewBox="0 0 320 480">
<defs><linearGradient id="back" x2="1" y2="1"><stop stop-color="#27383c"/><stop offset="1" stop-color="#131c29"/></linearGradient></defs>
<rect x="2" y="2" width="316" height="476" rx="14" fill="#171d22" stroke="#d4be87" stroke-width="4"/>
<rect x="13" y="13" width="294" height="454" rx="8" fill="url(#back)" stroke="#b9a273" stroke-width="2"/>
<rect x="25" y="25" width="270" height="430" rx="3" fill="none" stroke="#b9a273" opacity=".45"/>
<g fill="none" stroke="#cdb57c"><path d="M160 65 267 240 160 415 53 240Z"/><path d="m160 94 88 146-88 146-88-146Z" opacity=".4"/>
<circle cx="160" cy="240" r="73"/><circle cx="160" cy="240" r="59" opacity=".5"/>
<path d="M160 137v206M57 240h206" opacity=".35"/></g>
<path d="m160 180 15 44 45 16-45 16-15 44-15-44-45-16 45-16Z" fill="#d3bc86"/>
<circle cx="160" cy="240" r="10" fill="#1b2832"/>
<g fill="#d3bc86"><path d="m48 47 5 10-5 10-5-10Zm224 0 5 10-5 10-5-10ZM48 413l5 10-5 10-5-10Zm224 0 5 10-5 10-5-10Z"/></g></svg>`)}`;

export function trumpPresentation(state) {
  const appearance = trumpStyle(state);
  if (state.options?.deckMode === 'mono') {
    return { ...appearance, card: null, cardLabel: '', status: 'mono', label: '无主牌 · 单色牌库' };
  }
  const card = state.reveal || null;
  const cardLabel = !card ? '' : card.kind === 'number' ? `${SUIT_NAMES[card.suit]} ${card.rank}` : card.kind === 'wizard' ? '巫师' : '小丑';
  if (appearance.pending) return { ...appearance, card, cardLabel, status: 'pending', label: '等待庄家选择主牌' };
  if (state.trump) return { ...appearance, card, cardLabel, status: 'suit', label: `主牌 · ${SUIT_NAMES[state.trump]}${card?.kind === 'wizard' ? '（巫师指定）' : ''}` };
  return { ...appearance, card, cardLabel, status: card?.kind === 'jester' ? 'jester' : 'exhausted', label: card?.kind === 'jester' ? '无主牌 · 翻开小丑' : '无主牌 · 牌库已用尽' };
}

export function renderTrumpDisplay(table, state) {
  const display = trumpPresentation(state);
  table.style.setProperty('--trump-color', display.color);
  table.dataset.trumpSuit = display.suit;
  table.querySelector('.trump-display')?.remove();
  const root = document.createElement('div');
  root.className = 'trump-display';
  root.dataset.state = display.status;
  if (display.card) {
    const card = document.createElement('div');
    card.className = 'trump-card';
    card.setAttribute('aria-label', `翻开的主牌：${display.cardLabel}`);
    const rotor = document.createElement('div');
    rotor.className = 'trump-card-rotor';
    for (const [side, src] of [['front', cardImage(display.card)], ['back', CARD_BACK_IMAGE]]) {
      const face = document.createElement('img');
      face.className = `trump-card-${side}`;
      face.src = src;
      face.alt = '';
      rotor.append(face);
    }
    card.append(rotor);
    root.append(card);
  } else {
    const sigil = document.createElement('span');
    sigil.className = 'trump-neutral-sigil';
    sigil.textContent = '✧';
    sigil.setAttribute('aria-hidden', 'true');
    root.append(sigil);
  }
  const label = document.createElement('div');
  label.className = 'table-trump';
  label.textContent = display.label;
  label.setAttribute('role', 'status');
  root.append(label);
  table.append(root);
}
