// Full-page screenshot of a URL at a given width, no 5s MCP cap. Used by the
// match-section and match-page skills to capture source-vs-built crops.
// Usage: npx tsx scripts/_shot.ts <url> <outPath> <width>
import { chromium } from 'playwright';
const [, , url, out, widthArg] = process.argv;
const width = Number(widthArg || 1008);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
// Force below-fold lazy images to load by scrolling through (mouse.wheel — no
// page.evaluate, so no tsx __name footgun), then back to top.
for (let y = 0; y < 6000; y += 700) { await page.mouse.wheel(0, 700); await page.waitForTimeout(120); }
await page.keyboard.press('Home').catch(() => {});
await page.waitForTimeout(2000);
await page.screenshot({ path: out, fullPage: true, timeout: 60_000 });
await b.close();
console.log('wrote', out);
