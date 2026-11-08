// Run against a built site: GAME_QA_BASE_URL=http://127.0.0.1:4183 node scripts/check-game-mechanics.cjs
// Requires Playwright; PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE_PATH can select an existing install.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.GAME_QA_BASE_URL || 'http://127.0.0.1:4183';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    // QA must never send fabricated player activity to production.
    await context.route('**/events', r => r.fulfill({ status: 204 }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install();
    await page.goto(`${base}/games/watersort/?sample=1`);
    await page.waitForFunction(() => window.splashSort?.state());
    await page.evaluate(() => window.splashSort.autoplay());
    await page.clock.runFor(710); // solver selected a source; its delayed destination is pending
    await page.evaluate(() => window.splashSort.tap(0));
    const takeover = await page.evaluate(() => window.splashSort.state());
    await page.clock.runFor(2500);
    assert.deepEqual(await page.evaluate(() => window.splashSort.state()), takeover, 'manual takeover cancels pending and future solver pours');
    await page.evaluate(() => { window.splashSort.restart(); window.splashSort.autoplay(); });
    await page.clock.runFor(1000);
    assert.equal((await page.evaluate(() => window.splashSort.state())).moves, 1);
    await page.evaluate(() => window.splashSort.undo());
    const undone = await page.evaluate(() => window.splashSort.state());
    assert.equal(undone.moves, 0);
    await page.clock.runFor(2500);
    assert.deepEqual(await page.evaluate(() => window.splashSort.state()), undone, 'undo cancels solver replay');
    await page.evaluate(() => { window.splashSort.restart(); window.splashSort.autoplay(); });
    await page.clock.runFor(45000);
    assert.equal((await page.evaluate(() => window.splashSort.state())).status, 'won', 'uninterrupted replay still solves the game');
    console.log('PASS Splash Sort: takeover, undo, full solver replay');

    const id = '11111111-1111-4111-a111-111111111111';
    await context.route(`**/levels/${id}`, r => r.fulfill({ json: { game_id: 'lotescape', level: { title: 'Input QA', size: 6, move_limit: 10, vehicles: [{ id: 'a', x: 1, y: 2, length: 2, axis: 'h', exit: 'right', color: 'coral' }] } } }));
    const lot = await context.newPage(); lot.on('pageerror', e => errors.push(e.message));
    await lot.goto(`${base}/games/lotescape/?level=${id}`);
    await lot.waitForFunction(() => window.lotEscape?.state().title === 'Input QA');
    const car = lot.locator('.car[data-id="a"]'), box = await car.boundingBox();
    await lot.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await lot.mouse.down();
    await lot.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
    await car.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
    await lot.mouse.up();
    assert.equal((await lot.evaluate(() => window.lotEscape.state())).moves, 0, 'canceled drag spends no moves');
    await lot.locator('[data-dir="right"]').click();
    assert.equal((await lot.evaluate(() => window.lotEscape.state())).moves, 1, 'controls still work after cancel');
    await lot.locator('#reset').click();
    assert.equal((await lot.evaluate(() => window.lotEscape.state())).moves, 0);
    assert.deepEqual(errors, [], 'no browser exceptions');
    await lot.clock.install();
    await lot.evaluate(() => window.lotEscape.autoplay());
    await lot.clock.runFor(290);
    await lot.locator('[data-dir="right"]').click();
    const lotTakeover = await lot.evaluate(() => window.lotEscape.state());
    await lot.clock.runFor(1500);
    assert.deepEqual(await lot.evaluate(() => window.lotEscape.state()), lotTakeover, 'manual lot controls cancel replay');
    console.log('PASS Lot Escape: canceled drag, controls, restart, replay takeover');

    const trail = await context.newPage(); trail.on('pageerror', e => errors.push(e.message));
    await trail.clock.install();
    await trail.goto(`${base}/games/platformer/?sample=1`);
    await trail.waitForFunction(() => window.mosslightTrails?.state());
    await trail.evaluate(() => window.mosslightTrails.autoplay());
    await trail.clock.runFor(340);
    await trail.locator('.landing').first().click();
    const trailTakeover = await trail.evaluate(() => window.mosslightTrails.state());
    await trail.clock.runFor(1500);
    assert.deepEqual(await trail.evaluate(() => window.mosslightTrails.state()), trailTakeover, 'manual landing cancels replay');
    await trail.evaluate(() => { window.mosslightTrails.restart(); window.mosslightTrails.autoplay(); });
    await trail.clock.runFor(15000);
    assert.equal((await trail.evaluate(() => window.mosslightTrails.state())).status, 'won');
    assert.deepEqual(errors, [], 'no browser exceptions');
    console.log('PASS Mosslight Trails: replay takeover and full solver replay');
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
