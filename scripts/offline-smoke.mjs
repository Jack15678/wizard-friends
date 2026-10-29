import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

// Local/manual compatibility check: no WebGL and no room service required to
// continue an already-loaded practice, including foresight and secret bids.
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true,
  args: ['--disable-webgl'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [];
let page = await context.newPage();
const saved = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session') || 'null'));
try {
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8787/');
  await page.locator('#practice').click(); await page.locator('#begin-vote').click();
  await page.locator('input[name="foresight"][value="true"]').check();
  await page.locator('input[name="predictionMode"][value="secret"]').check();
  await page.locator('#submit-vote').click(); await page.locator('#start').click();
  await expect(page.locator('.concealed-hand')).toBeVisible();
  await expect(page.locator('.foresight-player')).toHaveCount(2);
  await expect(page.locator('body.has-webgl')).toHaveCount(0);
  await context.setOffline(true);
  for (let step = 0; step < 45; step++) {
    const record = await saved(); if (record?.game.phase === 'roundEnd') break;
    if (await page.locator('[data-trump]').count()) await page.locator('[data-trump]').first().click();
    else if (await page.locator('[data-bid]').count()) await page.locator('[data-bid]').first().click();
    else if (await page.locator('.hand .playable').count()) {
      await page.locator('.hand .playable').first().click();
      await page.locator('#confirm-play').click();
    }
    await page.waitForTimeout(250);
  }
  await expect.poll(async () => (await saved())?.game.phase).toBe('roundEnd');
  await expect(page.locator('.personal-result')).toBeVisible();
  const result = (await saved()).game.history;
  await page.locator('#leave').click(); await page.locator('#create').waitFor();
  await page.locator('#resume-practice').click();
  await expect.poll(async () => (await saved())?.game.history).toEqual(result);
  fs.mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/offline-2d-result.png' });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ verified: ['2D fallback', 'foresight', 'secret bids', 'offline practice round',
    'explicit leave and local resume', 'round result'], errors }));
} finally { await browser.close(); }
