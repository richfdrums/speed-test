/* Rasterises icons/icon.svg into the PNG sizes iOS and the manifest want.
   The maskable icon pads the artwork so Android's circle crop keeps it whole. */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ICONS = path.resolve(__dirname, "..", "icons");
const svg = fs.readFileSync(path.join(ICONS, "icon.svg"), "utf8");

const OUT = [
  { file: "apple-touch-icon.png", size: 180, pad: 0, bg: null },
  { file: "icon-192.png", size: 192, pad: 0, bg: null },
  { file: "icon-512.png", size: 512, pad: 0, bg: null },
  { file: "icon-maskable-512.png", size: 512, pad: 0.12, bg: "#06080D" }
];

(async () => {
  const browser = await chromium.launch();
  for (const o of OUT) {
    const page = await browser.newPage({ viewport: { width: o.size, height: o.size } });
    const inner = Math.round(o.size * (1 - o.pad * 2));
    // iOS and maskable launchers apply their own corner mask, so those get square corners.
    const art = o.file !== "icon-192.png" && o.file !== "icon-512.png" ? svg.replace('rx="112"', 'rx="0"') : svg;
    await page.setContent(
      `<html><body style="margin:0;display:grid;place-items:center;width:${o.size}px;height:${o.size}px;background:${o.bg || "transparent"}">` +
      `<div style="width:${inner}px;height:${inner}px">${art.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`
    );
    await page.screenshot({ path: path.join(ICONS, o.file), omitBackground: !o.bg });
    await page.close();
    console.log("wrote icons/" + o.file);
  }
  await browser.close();
})();
