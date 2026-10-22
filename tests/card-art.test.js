import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { cardImage } from '../src/card-art.js';
import { deck } from '../src/game.js';

test('the 60-card deck maps to exactly the 54 supplied illustrations', () => {
  const cards = deck();
  const urls = new Set(cards.map(cardImage));
  assert.equal(cards.length, 60);
  assert.equal(urls.size, 54);
  const files = readdirSync(new URL('../src/assets/cards/', import.meta.url)).filter(f => f.endsWith('.svg'));
  assert.deepEqual([...urls].map(url => new URL(url).pathname.split('/').at(-1)).sort(), files.sort());
  for (const card of cards) {
    const filename = card.kind === 'number'
      ? `${card.suit}-${String(card.rank).padStart(2, '0')}.svg` : `${card.kind}.svg`;
    assert.ok(cardImage(card).endsWith(`/${filename}`));
  }
  assert.equal(cardImage({ kind: 'wizard', id: 'sample-wizard' }), cardImage({ kind: 'wizard', id: 'wizard-3' }));
});

test('all card faces retain the 2:3 geometry used by hands and WebGL', () => {
  for (const url of new Set(deck().map(cardImage))) {
    const svg = readFileSync(new URL(url), 'utf8');
    assert.match(svg, /<svg\b[^>]*\bwidth="320"[^>]*\bheight="480"[^>]*\bviewBox="0 0 320 480"/);
    assert.doesNotMatch(svg, /<(?:image|text|script|foreignObject)\b/i, url);
  }
});
