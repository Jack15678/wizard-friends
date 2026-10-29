/**
 * JSON-persisted ChaCha20 stream, ported from magical-athlete-online/src/shared/random.ts.
 * Reference commit: 91c6a0f6f698eceb76078e0e72ba4ad3691605a2.
 * Algorithm and byte ordering: RFC 8439 §§2.1–2.3; regression vectors in random.test.js.
 * This is a random stream, not an encryption API. Never publish its key or buffered words.
 */
const RANGE = 0x100000000;
const wordsValid = (words, length) => Array.isArray(words) && words.length === length &&
  words.every(value => Number.isInteger(value) && value >= 0 && value < RANGE);
export function secureRandomSeed() {
  return Array.from(crypto.getRandomValues(new Uint32Array(11)));
}
export function createRandomStream(seed = secureRandomSeed()) {
  if (!wordsValid(seed, 11)) throw Error('随机种子必须包含11个32位无符号整数。');
  return { algorithm: 'chacha20-v1', key: seed.slice(0, 8), nonce: seed.slice(8), counter: 0, words: [], offset: 0 };
}
const rotate = (value, bits) => (value << bits) | (value >>> (32 - bits));
function quarter(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotate(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotate(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotate(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotate(x[b] ^ x[c], 7);
}
export function chacha20Block(key, nonce, counter) {
  if (!wordsValid(key, 8) || !wordsValid(nonce, 3) || !Number.isInteger(counter) || counter < 0 || counter >= RANGE) {
    throw Error('随机流参数无效或已耗尽。');
  }
  const initial = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...key, counter, ...nonce]);
  const x = new Uint32Array(initial);
  for (let round = 0; round < 10; round++) {
    quarter(x, 0, 4, 8, 12); quarter(x, 1, 5, 9, 13); quarter(x, 2, 6, 10, 14); quarter(x, 3, 7, 11, 15);
    quarter(x, 0, 5, 10, 15); quarter(x, 1, 6, 11, 12); quarter(x, 2, 7, 8, 13); quarter(x, 3, 4, 9, 14);
  }
  return Array.from(x, (value, index) => (value + initial[index]) >>> 0);
}
export function validRandomStream(stream) {
  return stream?.algorithm === 'chacha20-v1' && wordsValid(stream.key, 8) && wordsValid(stream.nonce, 3) &&
    Number.isInteger(stream.counter) && stream.counter >= 0 && stream.counter <= RANGE &&
    wordsValid(stream.words, stream.words?.length) && [0, 16].includes(stream.words.length) &&
    Number.isInteger(stream.offset) && stream.offset >= 0 && stream.offset <= stream.words.length;
}
export function nextRandomWord(stream) {
  if (!validRandomStream(stream)) throw Error('随机流存档无效。');
  if (stream.offset >= stream.words.length) {
    const block = chacha20Block(stream.key, stream.nonce, stream.counter);
    stream.counter++;
    stream.words = block;
    stream.offset = 0;
  }
  return stream.words[stream.offset++];
}
/** Returns 1..max. Reject the incomplete high interval rather than introducing modulo bias. */
export function uniformInteger(max, word) {
  if (!Number.isInteger(max) || max < 1 || max > RANGE) throw Error('随机范围无效。');
  const limit = RANGE - RANGE % max;
  let value;
  do {
    value = word();
    if (!Number.isInteger(value) || value < 0 || value >= RANGE) throw Error('随机源必须返回32位无符号整数。');
  } while (value >= limit);
  return value % max + 1;
}
export function shuffle(cards, stream = createRandomStream()) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = uniformInteger(i + 1, () => nextRandomWord(stream)) - 1;
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
