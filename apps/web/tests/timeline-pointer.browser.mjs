// bun tests/timeline-pointer.browser.mjs (after playwright-core install chromium)
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const bundle = await Bun.build({
  entrypoints: [import.meta.dir + "/timeline-pointer.fixture.ts"],
  format: "iife",
  define: {
    "import.meta.server": "false",
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
if (!bundle.success) throw new AggregateError(bundle.logs);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", console.error);
  await page.setContent(
    "<style>button { appearance:none; padding:0; border:0; width:25px; height:40px; background:red; transform: translateX(70px) } button:hover { background:lime } @media(min-width: 1px) { button:active { background:blue } } button span { display:block; height:100% } .glass {position:absolute;inset:0;pointer-events:none}</style>" +
      '<main id="editor">Editor</main><div id="app"></div><canvas width="120" height="40"></canvas>' +
      '<div inert style="position:fixed;left:-100000px;top:0;pointer-events:none"><div id="root" style="width:120px;height:40px"><button><span></span></button><div class="glass"></div></div></div>',
  );
  await page.mouse.move(300, 100);
  await page.evaluate(() => {
    window.events = [];
    window.clicks = 0;
    document.addEventListener("click", () => window.clicks++);
    document
      .querySelector("button")
      .addEventListener("stagepointerstate", (e) =>
        window.events.push(e.detail),
      );
  });
  await page.addScriptTag({ content: await bundle.outputs[0].text() });
  for (const mode of ["live", "capture"]) {
    for (const [time, rgb] of [
      [0, [255, 0, 0]],
      [1, [0, 255, 0]],
      [2, [0, 0, 255]],
      [3, [0, 255, 0]],
      [4, [255, 0, 0]],
      [2, [0, 0, 255]],
    ]) {
      await page.evaluate(([mode, time]) => window[mode](time), [mode, time]);
      await page.waitForFunction(
        (rgb) => {
          const px = document
            .querySelector("canvas")
            .getContext("2d")
            .getImageData(80, 20, 1, 1).data;
          return (
            rgb.every((v, i) => px[i] === v) &&
            getComputedStyle(document.querySelector("button"))
              .backgroundColor ===
              "rgb(" + rgb.join(", ") + ")"
          );
        },
        rgb,
        { timeout: 3000 },
      );
    }
  }
  assert.equal(await page.evaluate(() => window.clicks), 0);
  assert.deepEqual(await page.evaluate(() => window.events.slice(-5)), [
    { hover: true, pressed: false },
    { hover: true, pressed: true },
    { hover: true, pressed: false },
    { hover: false, pressed: false },
    { hover: true, pressed: true },
  ]);
  // An intercepting overlay wins; the transparent one did not.
  assert.deepEqual(await page.evaluate(async () => {
    document.querySelector('.glass').style.pointerEvents = 'auto';
    await window.capture(2);
    document.querySelector('button').focus();
    return [document.querySelector('.glass').hasAttribute('data-stage-active'),
      getComputedStyle(document.querySelector('button')).backgroundColor,
      document.activeElement === document.querySelector('button')];
  }), [true, 'rgb(255, 0, 0)', false]);
  console.log(
    "Live capture and frame-driven capture: computed button styles and raster pixels agree.",
  );
} finally {
  await browser.close();
}
