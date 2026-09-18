const { chromium } = require(process.env.P + '/playwright');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  for (const i of [1,2,3]) {
    await pg.goto('file://' + process.cwd() + '/index.html?mock=' + i);
    await pg.evaluate(() => document.fonts.ready);
    await pg.waitForTimeout(1200);
    await pg.screenshot({ path: `mockups/screen-${i}.png` });
  }
  await b.close();
})();
