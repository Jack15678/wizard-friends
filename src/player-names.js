const FIRST = ['星河', '晨雾', '月光', '青山', '流云', '松风', '落霞', '微雨', '晴空', '暖阳', '冰湖', '花海', '远帆', '秋叶', '晚星', '白露'];
const LAST = ['巫师', '旅人', '诗人', '信使', '学徒', '游侠', '画师', '船长', '精灵', '骑士', '观星者', '寻梦人', '守林人', '拾光者', '吟游者', '探险家'];
const nameKey = name => name.trim().normalize('NFKC').toLowerCase();
const randomValue = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;

export function validateName(name) {
  if (typeof name !== 'string' || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) {
    throw new Error('昵称需要 1–16 个字符，不能包含换行或隐藏字符。');
  }
  const normalized = name.trim().normalize('NFC');
  if (!normalized || normalized.length > 16) throw new Error('昵称需要 1–16 个字符。');
  return normalized;
}

export function uniqueRandomName(existingNames = [], random = randomValue) {
  const used = new Set(existingNames.map(nameKey));
  for (let attempt = 0; attempt < 32; attempt++) {
    const first = FIRST[Math.floor(random() * FIRST.length)];
    const last = LAST[Math.floor(random() * LAST.length)];
    const tail = Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0');
    const name = `${first}${last}-${tail}`;
    if (!used.has(nameKey(name))) return name;
  }
  // A broken or deterministic RNG must still let a new player take a unique name.
  for (let suffix = 1; suffix <= used.size + 1; suffix++) {
    const name = `星河旅人-${suffix.toString(36)}`;
    if (!used.has(nameKey(name))) return name;
  }
}

export function resolveName(name, existingNames = [], { automatic = false } = {}) {
  if (typeof name === 'string' && !name.trim()) return uniqueRandomName(existingNames);
  const normalized = validateName(name);
  if (!existingNames.some(existing => nameKey(existing) === nameKey(normalized))) return normalized;
  if (automatic) return uniqueRandomName(existingNames);
  throw new Error('昵称已被使用，请换一个名字。');
}
