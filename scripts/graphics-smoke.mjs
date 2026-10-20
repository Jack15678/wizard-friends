import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  // Use the real renderer in isolation so cards, camera and light stay identical.
  await page.route('**/__graphics_smoke__', route => route.fulfill({
    contentType: 'text/html',
    body: '<style>body{margin:0;background:#151213}#table{width:960px;height:640px}</style><div id="table"></div>',
  }));
  await page.goto(new URL('__graphics_smoke__', base).href);
  await page.evaluate(async () => {
    const { TableScene } = await import('/src/table-scene.js');
    const state = { phase: 'bid', options: { deckMode: 'standard' }, round: 1, completedTricks: 0,
      trick: [], trump: 'red', reveal: { kind: 'wizard', id: 'wizard-0' } };
    const create = async low => {
      // Keep context antialiasing identical; select quality before the first render.
      localStorage.setItem('wizard-low-graphics', 'false');
      const scene = new TableScene();
      if (low) scene.setLow(true);
      scene.trumpMotion = false;
      scene.attach(document.querySelector('#table'), state);
      await new Promise(resolve => setTimeout(resolve, 500));
      return scene;
    };
    const pixels = scene => {
      scene.renderer.render(scene.scene, scene.camera);
      const gl = scene.renderer.getContext();
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    };
    const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
    const scene = await create(false);
    const high = pixels(scene);
    scene.setLow(true);
    await new Promise(resolve => setTimeout(resolve, 150));
    const switchedLow = pixels(scene);
    await new Promise(resolve => requestAnimationFrame(resolve));
    // A renderer first drawn in low power is the reference for "no shadow".
    scene.attach(null);
    scene.renderer.domElement.remove();
    const freshLow = await create(true);
    const low = pixels(freshLow);
    window.graphicsResult = {
      changed: difference(high, low),
      lowError: difference(switchedLow, low),
      savedLow: localStorage.getItem('wizard-low-graphics'),
    };
    freshLow.setLow(false);
    await new Promise(resolve => setTimeout(resolve, 150));
    window.graphicsResult.highError = difference(pixels(freshLow), high);
    freshLow.setLow(true);
    await new Promise(resolve => setTimeout(resolve, 150));
    window.graphicsResult.lowAgainError = difference(pixels(freshLow), low);
    window.graphicsResult.savedLowAgain = localStorage.getItem('wizard-low-graphics');
  });
  const result = await page.evaluate(() => window.graphicsResult);
  await page.screenshot({ path: '.local/graphics-low-shadows.png' });
  console.log(JSON.stringify({ ...result, errors }));
  expect(result.changed).toBeGreaterThan(.1);
  expect(result.lowError).toBeLessThan(.01);
  expect(result.highError).toBeLessThan(.01);
  expect(result.lowAgainError).toBeLessThan(.01);
  expect(result.savedLow).toBe('true');
  expect(result.savedLowAgain).toBe('true');
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
