import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const NativeAudio = window.AudioContext;
    window.__musicContexts = [];
    window.AudioContext = class extends NativeAudio {
      constructor(...args) { super(...args); window.__musicContexts.push(this); }
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  expect(await page.evaluate(() => window.__musicContexts.length)).toBe(0);
  await page.locator('#quick-settings > summary').click();
  await page.locator('#music-toggle').click();
  await expect(page.locator('#music-panel')).toHaveAttribute('data-status', 'playing');
  await page.locator('#music-volume').fill('40');
  await expect(page.locator('#music-volume-value')).toHaveText('40%');
  await page.locator('#music-mute').click();
  await expect.poll(() => page.evaluate(() => window.__musicContexts[0].state)).toBe('suspended');
  await page.locator('#music-mute').click();
  await expect(page.locator('#music-panel')).toHaveAttribute('data-status', 'playing');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.__musicContexts[0].state)).toBe('suspended');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#music-panel')).toHaveAttribute('data-status', 'playing');
  await page.locator('#music-close').click();
  await page.locator('#quick-settings > summary').click();
  await page.locator('#practice').click();
  await page.locator('#begin-vote').click();
  await page.locator('#submit-vote').click();
  await page.locator('#start').click();
  expect(await page.evaluate(() => window.__musicContexts.length)).toBe(1);
  await page.locator('#table-menu').click();
  await page.locator('#music-toggle').click();
  await expect(page.locator('#music-panel')).toHaveAttribute('data-status', 'playing');
  await page.locator('#music-mute').click();
  await page.reload();
  await page.locator('.table').waitFor();
  await page.locator('#table-menu').click();
  await expect(page.locator('#music-toggle')).toContainText('已静音');
  await page.locator('#music-toggle').click();
  expect(await page.evaluate(() => window.__musicContexts.length)).toBe(0);
  await expect(page.locator('#music-volume')).toHaveValue('40');
  await page.locator('#music-mute').click();
  await expect(page.locator('#music-panel')).toHaveAttribute('data-status', 'playing');
  // Render the complete score offline to check actual PCM output, not just controls.
  const audio = await page.evaluate(async () => {
    const { scheduleBar, BEAT } = await import('/src/music.js');
    const ctx = new OfflineAudioContext(2, Math.ceil((16 * 4 * BEAT + 6) * 22050), 22050);
    const gain = ctx.createGain(); gain.gain.value = 4; gain.connect(ctx.destination);
    for (let bar = 0; bar < 16; bar++) scheduleBar(ctx, gain, bar, bar * 4 * BEAT);
    const result = await ctx.startRendering();
    let peak = 0, energy = 0, finite = true;
    for (const value of result.getChannelData(0)) {
      finite &&= Number.isFinite(value);
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
    return { peak, rms: Math.sqrt(energy / result.length), finite, duration: result.duration };
  });
  expect(audio.finite).toBe(true);
  expect(audio.peak).toBeGreaterThan(.02);
  expect(audio.peak).toBeLessThan(.8);
  expect(audio.rms).toBeGreaterThan(.005);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ playback: 'gesture start, mute/resume, volume persistence, one context across scenes', audio, errors }));
} finally { await browser.close(); }
