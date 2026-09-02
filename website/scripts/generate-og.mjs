/**
 * Regenerate public/og.png, the 1200x630 social card.
 *
 * Manual dev tool, not part of the build or deploy. Run it whenever the
 * headline, the tagline, or the palette changes:
 *
 *   node scripts/generate-og.mjs
 *
 * The card is LIGHT, while the site itself is dark-first. That is deliberate.
 * A social card is a static image with no theme to follow, so it is rendered
 * once against one palette and then read inside someone else's surface: an X
 * timeline, a Slack unfurl, an iMessage bubble, a LinkedIn feed. Those
 * surfaces are overwhelmingly light, and a near-black card sits in them as a
 * hole rather than as a card. The light translation of the site's own tokens
 * reads as the same brand and stays legible at the thumbnail sizes an unfurl
 * actually renders.
 *
 * Prerequisites: ImageMagick (the `magick` binary) on PATH. Playwright is a
 * website devDependency (shared with the browser-test toolchain) and resolves
 * from node_modules.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'public/og.png');

// The card carries the REAL lockup file rather than a redrawn copy, for the
// same reason the site does: a redraw is how the logo drifted once already.
// The on-light variant, because the card is light. Inlined rather than <img>
// so the render has no file:// fetch to race.
const LOCKUP_SVG = readFileSync(resolve('public/brand/webjs-lockup-on-light.svg'), 'utf8');

// Fonts are inlined as data URIs rather than fetched from Google Fonts. The
// render then needs no network at all, so it cannot silently fall back to a
// system face mid-encode and ship a card in the wrong type. Same three files
// the site preloads, so the card and the page cannot diverge. Each is one
// variable file covering every weight.
const fontDataUri = (file) =>
  `data:font/woff2;base64,${readFileSync(resolve('public/fonts', file)).toString('base64')}`;
const INTER_TIGHT = fontDataUri('inter-tight.woff2');
const INTER = fontDataUri('inter.woff2');
const MONO = fontDataUri('jetbrains-mono.woff2');

// The LIGHT half of the light-dark() token pairs in app/layout.ts, resolved
// here because a static PNG has no light-dark() to resolve. Keep these in
// lockstep with that block.
const T = {
  bg: 'oklch(0.985 0.008 75)',
  fg: 'oklch(0.20 0.018 60)',
  fgMuted: 'oklch(0.44 0.02 60)',
  fgSubtle: 'oklch(0.50 0.02 65)',
  border: 'oklch(0.88 0.012 70)',
  accent: 'oklch(0.54 0.16 52)',
};

// The promise, verbatim from the homepage hero and the site-wide meta
// description. One string on every surface, so a shared link and the page it
// opens say the same sentence.
const TITLE = 'Production-ready architecture from your very first prompt';
// Accented through the first two words only. The whole headline in accent
// competes with the lockup directly above it, and accenting the tail buries
// the differentiating claim in the colour the eye reaches last.
const TITLE_HTML = TITLE.replace('Production-ready', '<span class="accent">Production-ready</span>');

// What the thing IS, under what it PROMISES. The lockup already says the name,
// so the sentence opens on the category instead of repeating it.
const LEDE = 'An AI-first full-stack JavaScript web components framework with no build step.';

// Three claims, so the strip cannot afford a repeated suffix: this read
// "AI-FIRST / WEB-COMPONENTS-FIRST / NO BUILD", and two of them ending the same
// way landed as a tic rather than as two separate stances. "-first" was also
// the wrong word for the middle one. Web components are not a preference this
// framework ranks highly, they are its component model, the way Next is
// React-based rather than React-first. As a bare fact it matches the register
// of NO BUILD beside it. The hyphens went with the suffix, since they only ever
// bound the compound modifier and the platform feature is two plain words.
const TAGS = 'AI-FIRST &nbsp;&middot;&nbsp; WEB COMPONENTS &nbsp;&middot;&nbsp; NO BUILD';

const html0 = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
  @font-face{font-family:'Inter Tight';font-weight:100 900;src:url('${INTER_TIGHT}') format('woff2');}
  @font-face{font-family:'Inter';font-weight:100 900;src:url('${INTER}') format('woff2');}
  @font-face{font-family:'JetBrains Mono';font-weight:100 800;src:url('${MONO}') format('woff2');}
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ width:1200px; height:630px; }
  body{
    font-family:'Inter',system-ui,sans-serif;
    background:${T.bg};
    color:${T.fg};
    position:relative;
    overflow:hidden;
  }
  /* The one piece of colour that survives a thumbnail. At 1200x630 scaled into
     a timeline the headline is unreadable but the bar still reads as the
     brand's orange, which is what makes the card recognisable before it is
     legible. */
  .bar{ position:absolute; left:0; top:0; width:100%; height:10px; background:${T.accent}; }
  .frame{
    position:relative; z-index:1;
    width:100%; height:100%;
    padding:72px 76px;
    display:flex; flex-direction:column;
  }
  .brand{ display:flex; align-items:center; }
  .brand svg{ height:44px; width:auto; display:block; }
  .mid{ flex:1; display:flex; flex-direction:column; justify-content:center; }
  h1{
    font-family:'Inter Tight',sans-serif; font-weight:800;
    /* Set by the fit pass below, which is why the value here is only a
       starting point rather than the designed size. */
    font-size:70px; line-height:1.05; letter-spacing:-0.035em;
    max-width:19ch;
  }
  .accent{ color:${T.accent}; }
  p.lede{
    margin-top:26px; max-width:34ch;
    font-size:25px; line-height:1.5; color:${T.fgMuted};
  }
  .foot{
    display:flex; align-items:center; justify-content:space-between;
    font-family:'JetBrains Mono',monospace; font-weight:500;
    font-size:15px; letter-spacing:0.04em; color:${T.fgSubtle};
  }
  .foot .tags{ display:flex; align-items:center; gap:10px; text-transform:uppercase; }
  .dot{ width:7px; height:7px; border-radius:50%; background:${T.accent}; }
  hr{ border:0; border-top:1px solid ${T.border}; margin-bottom:24px; }
</style></head>
<body>
  <div class="bar"></div>
  <div class="frame">
    <div class="brand">__LOCKUP__</div>
    <div class="mid">
      <h1>${TITLE_HTML}</h1>
      <p class="lede">${LEDE}</p>
    </div>
    <div>
      <hr>
      <div class="foot">
        <div class="tags"><span class="dot"></span>${TAGS}</div>
        <div>github.com/webjsdev/webjs</div>
      </div>
    </div>
  </div>
</body></html>`;
const html = html0.replace('__LOCKUP__', LOCKUP_SVG);

const tmp = mkdtempSync(join(tmpdir(), 'webjs-og-'));
const big = join(tmp, 'og-2x.png');

const browser = await chromium.launch();
let titlePx;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  // Shrink the headline until the card holds it. A 1200x630 card has nowhere
  // for overflow to go, so a headline one word too long is simply cut off in
  // every unfurl, with nothing in the render to signal it. Stepping down in
  // ones keeps a short headline exactly as it was drawn and costs a longer one
  // as little size as it can.
  titlePx = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const frame = document.querySelector('.frame');
    for (let px = 70; px >= 34; px -= 1) {
      h1.style.fontSize = px + 'px';
      if (frame.scrollHeight <= frame.clientHeight) return px;
    }
    return 34;
  });
  await page.screenshot({ path: big, clip: { x: 0, y: 0, width: 1200, height: 630 } });
} finally {
  await browser.close();
}
if (titlePx < 70) console.log(`Headline set at ${titlePx}px to fit the card.`);

// Downscale the 2400x1260 capture to an exact 1200x630 for crisp text, and
// losslessly optimize: strip metadata and use max PNG compression. PNG rather
// than WebP because it is the safe og:image format for every social unfurler.
execFileSync('magick', [big, '-resize', '1200x630', '-strip', '-define', 'png:compression-level=9', OUT], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
console.log('wrote', OUT);
