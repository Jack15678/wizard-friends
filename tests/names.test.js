import test from 'node:test';
import assert from 'node:assert/strict';
import { validateName, uniqueRandomName, resolveName } from '../src/player-names.js';

test('names trim and normalize display while preserving case and full-width characters', () => {
  assert.equal(validateName('  Alice  '), 'Alice');
  assert.equal(validateName('Ａｌｉｃｅ'), 'Ａｌｉｃｅ');
  assert.equal(validateName('Cafe\u0301'), 'Café');
  assert.equal(validateName('巫师'.repeat(8)), '巫师'.repeat(8));
  for (const name of ['', '   ', null, undefined, 123, {}, 'a'.repeat(17), '换\n行', '\t昵称',
    '隐\u200b藏', '伪\u202e装', '响\u0007铃', 'a\u0085b', 'a\u2028b']) {
    assert.throws(() => validateName(name), /昵称/);
  }
});

test('manual duplicates compare trimmed NFKC and case-insensitive keys for every occupied seat', () => {
  for (const name of ['Alice', ' alice ', 'ＡＬＩＣＥ']) {
    assert.throws(() => resolveName(name, ['  ALICE  ', '离线旅人', '机器人']), /已被使用/);
  }
  assert.throws(() => resolveName('离线旅人', ['离线旅人']), /已被使用/);
  assert.throws(() => resolveName('机器人', ['机器人']), /已被使用/);
  assert.equal(resolveName('  ALICE  ', ['另一个名字']), 'ALICE');
});

test('random names contain a readable Chinese combination and short tail and stay within limits', () => {
  const samples = [0, 0.01, 0.5, 0.999999];
  for (const sample of samples) {
    const name = uniqueRandomName([], () => sample);
    assert.match(name, /^[\u4e00-\u9fff]+-[0-9a-z]{4}$/);
    assert.equal(validateName(name), name);
    assert.ok(name.length <= 16);
  }
});

test('collision retries are bounded even with a constant random function', () => {
  let calls = 0;
  const random = () => { calls++; return 0; };
  const generated = uniqueRandomName([], random);
  calls = 0;
  const fallback = uniqueRandomName([generated, '星河旅人-1', '星河旅人-2'], random);
  assert.equal(fallback, '星河旅人-3');
  assert.equal(calls, 32 * 3);
  assert.equal(validateName(fallback), fallback);
});

test('repeated additions remain unique and removed names may be reused', () => {
  const names = [];
  for (let i = 0; i < 100; i++) names.push(uniqueRandomName(names, () => 0));
  assert.equal(new Set(names).size, 100);
  const removed = names.splice(0, 1)[0];
  assert.equal(uniqueRandomName(names, () => 0), removed);
});

test('empty names and colliding automatic names receive Web Crypto generated replacements', () => {
  const occupied = ['星河巫师-0000'];
  for (const name of ['', '   ', occupied[0]]) {
    const resolved = resolveName(name, occupied, { automatic: true });
    assert.equal(validateName(resolved), resolved);
    assert.ok(!occupied.includes(resolved));
  }
  assert.match(resolveName('', occupied), /^[\u4e00-\u9fff]+-[0-9a-z]+$/);
  assert.equal(resolveName('唯一旅人', occupied, { automatic: true }), '唯一旅人');
  assert.throws(() => resolveName('换\n行', occupied, { automatic: true }), /昵称/);
});
