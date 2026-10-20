import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
fs.mkdirSync('.local', { recursive: true });
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const motionOnly = process.argv.includes('--motion-only');
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observe = page => page.on('pageerror', error => errors.push(error.message));
async function checkVariantGame() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  observe(page);
  await page.goto(base);
  const name = await page.locator('#nickname').inputValue();
  expect(name).toMatch(/^[\u4e00-\u9fff]+-[0-9a-z]+$/);
  const identity = await page.evaluate(() => sessionStorage.getItem('wizard-player-token'));
  await page.reload();
  await expect(page.locator('#nickname')).toHaveValue(name);
  expect(await page.evaluate(() => sessionStorage.getItem('wizard-player-token'))).toBe(identity);
  const second = await context.newPage();
  observe(second);
  await second.goto(base);
  expect(await second.locator('#nickname').inputValue()).not.toBe(name);
  await second.close();

  await page.locator('#nickname').fill('');
  await page.locator('#practice').click();
  const finalName = await page.locator('.my-seat .seat-name b').textContent();
  expect(finalName).toMatch(/^[\u4e00-\u9fff]+-[0-9a-z]+$/);
  expect(await page.evaluate(() => sessionStorage.getItem('wizard-name'))).toBe(finalName);
  for (let i = 0; i < 4; i++) {
    await page.locator('[data-remove]').last().click();
    await page.locator('#addbot').click();
    const names = await page.locator('.seat-name b').allTextContents();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(3);
  }
  await page.locator('#begin-vote').click();
  expect(await page.locator('.vote-members span').count()).toBe(1);
  expect(await page.locator('#addbot, [data-remove]').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scrollable = await page.locator('.rules-vote').evaluate(panel => {
    const previous = panel.scrollTop;
    panel.scrollTop = panel.scrollHeight;
    return panel.scrollHeight > panel.clientHeight && panel.scrollTop > previous;
  });
  expect(scrollable).toBe(true);
  await page.screenshot({ path: '.local/variants-vote-mobile.png', fullPage: true });
  for (const [key, value] of Object.entries({ deckMode: 'mono', predictionMode: 'secret', strict: 'true', foresight: 'true', short: 'true' })) {
    await page.locator(`input[name="${key}"][value="${value}"]`).check();
  }
  await page.locator('#submit-vote').click();
  await expect(page.locator('.vote-result')).toContainText('单色牌库 · 秘密数字 · 先见之明 · 快速局');
  await expect(page.locator('.vote-result')).not.toContainText('加减预估');
  await page.locator('#start').click();
  await expect(page.locator('.concealed-hand')).toContainText('4 张手牌暂时保密');
  expect(await page.locator('.hand .card').count()).toBe(0);
  expect(await page.locator('.foresight-hands .card').count()).toBe(8);
  await expect(page.locator('.table-trump')).toHaveText('无主牌 · 单色牌库');
  const trumpBounds = await page.locator('.table-trump').boundingBox();
  const foresightBounds = await page.locator('.foresight-hands').boundingBox();
  expect(trumpBounds).not.toBeNull();
  expect(foresightBounds).not.toBeNull();
  const trumpOverlapsForesight = trumpBounds.x < foresightBounds.x + foresightBounds.width &&
    trumpBounds.x + trumpBounds.width > foresightBounds.x &&
    trumpBounds.y < foresightBounds.y + foresightBounds.height &&
    trumpBounds.y + trumpBounds.height > foresightBounds.y;
  expect(trumpOverlapsForesight, 'Mobile foresight cards must not cover the central trump label').toBe(false);
  expect(await page.locator('.trump-marker, .trump-card').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/variants-foresight-mobile.png', fullPage: true });
  await page.locator('[data-bid="0"]').click();
  await expect(page.locator('.concealed-hand')).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('.foresight-hands')).toHaveCount(0);
  await expect(page.locator('.opponents .player:not(.self) .prediction').first()).toContainText('已锁定');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const rounds = new Map();
  for (let step = 0; step < 1200; step++) {
    const round = Number(await page.locator('.roundbar b').textContent());
    const caption = await page.locator('.table-caption').textContent();
    const maxCards = Number(caption.match(/\/\s*(\d+)\s*墩/)[1]);
    expect(maxCards).toBe(round + 3);
    rounds.set(round, maxCards);
    if (await page.locator('#rematch').count()) break;
    if (await page.locator('[data-bid]').count()) await page.locator('[data-bid]').first().click();
    else if (await page.locator('.hand .playable').count()) await page.locator('.hand .playable').first().click();
    else if (await page.locator('#next').count()) await page.locator('#next').click();
    else await page.waitForTimeout(180);
  }
  await expect(page.locator('#rematch')).toHaveCount(1);
  expect([...rounds.values()]).toEqual([4, 5, 6, 7, 8]);
  expect(await page.locator('.history tbody tr').count()).toBe(5);
  await page.screenshot({ path: '.local/variants-mono-complete.png', fullPage: true });
  await page.locator('.close-scores').click();
  await page.locator('#rematch').click();
  await expect(page.locator('.my-seat .seat-name b')).toHaveText(finalName);
  await page.locator('#begin-vote').click();
  await expect(page.locator('.vote-count')).toHaveText('0 / 1 已提交');
  await page.locator('#cancel-vote').click();
  await expect(page.locator('#addbot')).toBeVisible();
  await context.close();
}
try {
  if (!motionOnly) await checkVariantGame();
  const reducedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const reduced = await reducedContext.newPage();
  observe(reduced);
  await reduced.goto(base);
  await reduced.locator('.scene-host.ready canvas').waitFor({ timeout: 20000 });
  // Isolate the trump region: a canvas element screenshot also includes overlaid
  // DOM such as the asynchronously changing online count.
  const trumpFrame = () => reduced.screenshot({ clip: { x: 780, y: 100, width: 460, height: 440 } });
  const expectStillTrump = () => expect.poll(async () => {
    const frame = await trumpFrame();
    await reduced.waitForTimeout(500);
    return (await trumpFrame()).equals(frame);
  }, { timeout: 6000 }).toBe(true);
  await expectStillTrump();
  await reduced.screenshot({ path: '.local/variants-reduced-motion.png', fullPage: true });
  await reduced.getByRole('button', { name: '主牌动画：关', exact: true }).click();
  await expect(reduced.locator('#trump-motion')).toHaveAttribute('aria-pressed', 'true');
  const movingFrame = await trumpFrame();
  await reduced.waitForTimeout(1000);
  expect((await trumpFrame()).equals(movingFrame)).toBe(false);
  await reduced.reload();
  await reduced.locator('.scene-host.ready canvas').waitFor({ timeout: 20000 });
  await expect(reduced.locator('#trump-motion')).toHaveText('主牌动画：开');
  await reduced.getByRole('button', { name: '主牌动画：开', exact: true }).click();
  await expectStillTrump();
  await reducedContext.close();
} finally {
  await browser.close();
}

const fallback = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl'] });
try {
  const context = await fallback.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  observe(page);
  await page.goto(base);
  await page.getByRole('button', { name: 'WebGL 不可用，已自动使用二维界面' }).waitFor();
  await page.locator('#practice').click();
  await page.locator('#begin-vote').click();
  await page.locator('#submit-vote').click();
  await page.locator('#start').click();
  await expect(page.locator('.trump-card')).toBeVisible();
  expect(await page.locator('.trump-marker').count()).toBe(0);
  const animationNames = await page.locator('.trump-card, .trump-card-rotor').evaluateAll(elements => elements.map(el => getComputedStyle(el).animationName));
  expect(animationNames).toEqual(['none', 'none']);
  await page.locator('#table-menu').click();
  await page.getByRole('button', { name: '主牌动画：关', exact: true }).click();
  const enabledAnimations = await page.locator('.trump-card, .trump-card-rotor').evaluateAll(elements => elements.map(el => getComputedStyle(el).animationName));
  expect(enabledAnimations).toEqual(['trump-float', 'trump-turn']);
  const firstTransform = await page.locator('.trump-card-rotor').evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(1000);
  expect(await page.locator('.trump-card-rotor').evaluate(el => getComputedStyle(el).transform)).not.toBe(firstTransform);
  await page.getByRole('button', { name: '主牌动画：开', exact: true }).click();
  expect(await page.locator('.trump-card-rotor').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.locator('#table-menu').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/variants-2d-reduced-mobile.png', fullPage: true });
} finally {
  await fallback.close();
}
expect(errors).toEqual([]);
console.log(JSON.stringify({
  ...(!motionOnly && { names: 'random, unique, refreshed identity preserved', vote: 'mobile scroll, frozen seats, cancel, rematch',
    variants: 'mono + secret + foresight, five rounds with 4–8 cards' }),
  reducedMotion: '3D and 2D default static; explicit animation toggle, pause and refresh persistence', errors }));
