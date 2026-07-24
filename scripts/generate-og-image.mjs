// Generates the shared 1200×630 social-sharing card served at
// /public/og-image.png and referenced by the OpenGraph / Twitter meta tags
// (see src/server/seo/meta.ts). Run with `node scripts/generate-og-image.mjs`
// whenever the brand or tagline changes.
//
// We render an HTML card with headless Chromium (already a dev dependency via
// Playwright/Puppeteer) and screenshot it, so the design lives in plain CSS and
// stays easy to tweak. The committed PNG is what actually ships — this script
// only needs to run when the card changes.
import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "src", "public", "og-image.png");

// Brand tokens mirror src/styles/input.css.
const html = `<!doctype html>
<html>
<head><meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #f5f7fa;
    background:
      radial-gradient(1100px 700px at 82% -18%, rgba(255,90,31,.28), transparent 60%),
      radial-gradient(760px 520px at 6% 118%, rgba(255,138,61,.16), transparent 55%),
      #0f1419;
    padding: 72px 76px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
    overflow: hidden;
  }
  .brand { display: flex; align-items: center; gap: 20px; }
  .glyph {
    width: 76px; height: 76px; border-radius: 20px;
    background: linear-gradient(145deg, #FF5A1F, #FF8A3D);
    box-shadow: 0 12px 36px rgba(255,90,31,.45);
    display: grid; place-items: center;
  }
  .glyph svg { width: 52px; height: 52px; }
  .wordmark { font-size: 44px; font-weight: 800; letter-spacing: -.02em; }
  .wordmark .mk { color: #FF8A3D; }

  .headline { font-size: 82px; font-weight: 820; line-height: 1.02; letter-spacing: -.035em; max-width: 20ch; }
  .headline .u { color: #FF7A3C; }
  .sub { margin-top: 26px; font-size: 30px; line-height: 1.4; color: #aab4bf; max-width: 30ch; }

  .foot { display: flex; align-items: center; gap: 16px; font-size: 22px; color: #8b97a3; }
  .pill {
    font-family: "SF Mono", ui-monospace, "Cascadia Code", Menlo, monospace;
    font-size: 19px; color: #c8d0d8;
    border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
    padding: 7px 14px; background: rgba(255,255,255,.04);
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #3a444e; }
</style></head>
<body>
  <div class="brand">
    <span class="glyph">
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M8 19.5 L16 10.8 L24 19.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M11 24 L16 18.6 L21 24" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <span class="wordmark">Git<span class="mk">Launch</span></span>
  </div>

  <div>
    <div class="headline">Trigger deployments with <span class="u">confidence</span></div>
    <div class="sub">One dashboard to ship and track releases across staging and production.</div>
  </div>

  <div class="foot">
    <span class="pill">GitHub Actions</span>
    <span class="dot"></span>
    <span class="pill">Jenkins</span>
    <span class="dot"></span>
    <span>staging → production</span>
  </div>
</body>
</html>`;

const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.screenshot({ path: OUT, type: "png" });
  console.log(`Wrote ${OUT}`);
} finally {
  await browser.close();
}
