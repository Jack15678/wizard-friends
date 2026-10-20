import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const errors = [];
try {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  for (const page of [first, second]) page.on('pageerror', e => errors.push(e.message));
  await first.goto(base);
  await expect(first.locator('#online-count')).toHaveText('约 1 人在线', { timeout: 45000 });
  await second.goto(base);
  await expect(first.locator('#online-count')).toHaveText('约 2 人在线', { timeout: 45000 });
  await expect(second.locator('#online-count')).toHaveText('约 2 人在线');
  const duplicate = await b.newPage();
  await duplicate.goto(base);
  await expect(duplicate.locator('#online-count')).toHaveText('约 2 人在线', { timeout: 45000 });
  await first.screenshot({ path: '.local/online-home.png', fullPage: true });
  await first.close();
  await expect(second.locator('#online-count')).toHaveText('约 1 人在线', { timeout: 60000 });
  await duplicate.close();
  await second.setViewportSize({ width: 390, height: 844 });
  await second.screenshot({ path: '.local/online-mobile.png', fullPage: true });
  expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await second.locator('#practice').click();
  await expect(second.locator('#online-count')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('Presence: 2 browsers, tab deduplication, coordinator failover, mobile and practice passed.');
} finally { await browser.close(); }
