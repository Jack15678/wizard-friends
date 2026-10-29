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

  // High-DPI phones must keep cards readable even with low-power graphics.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });
  const mobile = await phone.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.route('**/__graphics_smoke__', route => route.fulfill({ contentType: 'text/html',
    body: '<style>body{margin:0}#table{width:100vw;height:100vh}canvas{display:block;width:100%;height:100%}</style><div id="table"></div>' }));
  await mobile.goto(new URL('__graphics_smoke__', base).href);
  await mobile.evaluate(async () => {
    const { TableScene } = await import('/src/table-scene.js');
    window.phoneScene = new TableScene();
    window.phoneScene.trumpMotion = false;
    window.phoneCards = [
      { id: 'blue-13', kind: 'number', suit: 'blue', rank: 13 },
      { id: 'red-12', kind: 'number', suit: 'red', rank: 12 },
      { id: 'green-8', kind: 'number', suit: 'green', rank: 8 },
      { id: 'yellow-9', kind: 'number', suit: 'yellow', rank: 9 },
      { id: 'wizard-0', kind: 'wizard' }, { id: 'jester-0', kind: 'jester' },
    ];
  });
  const phoneResults = [];
  for (const size of [{ width: 390, height: 844 }, { width: 390, height: 676 }, { width: 320, height: 568 }]) {
    await mobile.setViewportSize(size);
    for (const count of [3, 4, 5, 6]) {
      const layout = await mobile.evaluate(count => {
        const scene = window.phoneScene;
        scene.attach(document.querySelector('#table'), { phase: 'trickEnd', round: 3, completedTricks: 1,
          options: { deckMode: 'standard' }, trump: 'blue', reveal: window.phoneCards[0], lastWinner: 0,
          trick: window.phoneCards.slice(0, count).map((card, player) => ({ card, player })) });
        scene.renderer.render(scene.scene, scene.camera);
        const bounds = face => {
          face.geometry.computeBoundingBox();
          const box = face.geometry.boundingBox;
          const corners = [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].map(y =>
            face.localToWorld(face.position.clone().set(x, y, 0)).project(scene.camera)));
          const left = Math.min(...corners.map(p => (p.x + 1) * innerWidth / 2));
          const right = Math.max(...corners.map(p => (p.x + 1) * innerWidth / 2));
          return { left, right, width: right - left };
        };
        const cards = [...scene.cards.values()].map(group => bounds(group.userData.face));
        return { count, viewport: innerWidth, dpr: scene.renderer.getPixelRatio(), low: scene.low,
          antialias: scene.renderer.getContext().getContextAttributes().antialias,
          shadows: scene.renderer.shadowMap.enabled, deck: bounds(scene.deck.children.at(-1)), cards };
      }, count);
      phoneResults.push(layout);
      expect(layout.low).toBe(true);
      expect(layout.dpr).toBe(2);
      expect(layout.antialias).toBe(true);
      expect(layout.shadows).toBe(false);
      expect(layout.deck.right, 'Decorative deck must not cover the first played card').toBeLessThan(layout.cards[0].left);
      for (const card of layout.cards) {
        expect(card.left, `${size.width} × ${size.height}, ${count} cards`).toBeGreaterThanOrEqual(0);
        expect(card.right, `${size.width} × ${size.height}, ${count} cards`).toBeLessThanOrEqual(size.width);
        expect(card.width, `${size.width} × ${size.height}, ${count} cards`).toBeGreaterThanOrEqual(count <= 4 ? 60 : 40);
      }
    }
  }
  await mobile.waitForFunction(() => [...window.phoneScene.textures.values()].every(t => t.image instanceof HTMLCanvasElement));
  await mobile.screenshot({ path: '.local/graphics-mobile-six.png' });
  // Moving the same scene back to desktop must undo the mobile card scale.
  await mobile.setViewportSize({ width: 1440, height: 1000 });
  const restored = await mobile.evaluate(() => {
    const scene = window.phoneScene;
    scene.resize(); scene.setLow(false);
    return { scales: [...scene.cards.values()].map(g => g.scale.x), dpr: scene.renderer.getPixelRatio(), shadows: scene.renderer.shadowMap.enabled };
  });
  expect(restored.scales).toEqual([1, 1, 1, 1, 1, 1]);
  expect(restored.dpr).toBe(2);
  expect(restored.shadows).toBe(true);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ phoneResults, restored, errors }));
} finally {
  await browser.close();
}
