/**
 * Regenerate public/og-why.png, the 1200x630 social card for the /why-webjs page.
 *
 * A sibling of scripts/generate-og.mjs (the home-page card): same light palette,
 * same top accent bar, same render pipeline (headless Chromium at 2x, downscaled
 * to an exact 1200x630 with ImageMagick for crisp text). It carries the pitch
 * page's headline and its two-fact story instead of the home card's tagline. Run
 * it whenever that headline or the look changes:
 *
 *   node scripts/generate-og-why.mjs
 *
 * Prerequisites: ImageMagick (the `magick` binary) on PATH. Playwright is a
 * website devDependency and resolves from node_modules.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'public/og-why.png');

// The REAL lockup file, on-light, same as the home card. This replaced a
// hand-drawn rounded square plus the word "webjs" set in Inter Tight, which was
// a redraw of a logo that has since changed: the wordmark is WebJs and the mark
// is not a plain gradient tile. A card is the one surface where nobody notices
// the drift, because it is generated once and then only ever seen inside
// somebody else's timeline.
const LOCKUP_SVG = readFileSync(resolve('public/brand/webjs-lockup-on-light.svg'), 'utf8');

// Inlined rather than fetched from Google Fonts, so the render has no network
// to fail and cannot silently ship a card set in a system fallback face.
const fontDataUri = (file) =>
  `data:font/woff2;base64,${readFileSync(resolve('public/fonts', file)).toString('base64')}`;
const INTER_TIGHT = fontDataUri('inter-tight.woff2');
const INTER = fontDataUri('inter.woff2');
const MONO = fontDataUri('jetbrains-mono.woff2');

// The LIGHT half of the light-dark() token pairs in app/layout.ts, matching
// scripts/generate-og.mjs. See that file for why the cards are light while the
// site is dark-first.
const T = {
  bg: 'oklch(0.985 0.008 75)',
  bgSubtle: 'oklch(0.96 0.008 75)',
  fg: 'oklch(0.20 0.018 60)',
  fgMuted: 'oklch(0.44 0.02 60)',
  fgSubtle: 'oklch(0.50 0.02 65)',
  border: 'oklch(0.88 0.012 70)',
  accent: 'oklch(0.54 0.16 52)',
};

// Verbatim from the page's own h1, so a shared link and the page it opens say
// the same sentence.
const TITLE = 'The framework your <span class="accent">AI agent</span> already understands';

// This card used to say the framework was one an agent "can read end to end",
// and that the agent "reads the whole framework and fits it into context".
// Both are false and the repo already knew it: the comment above DESCRIPTION in
// app/layout.ts records that packages/core/src alone is 23,465 lines and core
// plus server is 50,511, so nothing reads it end to end and none of it fits in
// a context window. The claim outlived the section it was written for, and a
// generated card is exactly where that survives unreviewed.
//
// The true version of the idea is about LOCATION rather than volume, which is
// what the page itself has said all along: the source sits in the app's own
// node_modules at the installed version, so the agent opens the file it is
// calling instead of recalling an API from training data. That is also the
// stronger claim, because it holds no matter how large the framework grows.
const SUB = 'A <b>full-stack JavaScript framework</b> with no build step, so nothing is hidden from your agent.';
const FACTS = [
  {
    label: 'Framework source',
    text: 'No build, <span class="mono">node_modules</span> holds plain JS. <span class="q">The agent opens the file it is calling instead of recalling an API from training data.</span>',
  },
  {
    label: 'Your app code',
    text: 'Served to the browser as written. <span class="q">The agent debugs the running app against the real source, not a bundle.</span>',
  },
];

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
  .bar{ position:absolute; left:0; top:0; width:100%; height:10px; background:${T.accent}; }
  .frame{
    position:relative; z-index:1;
    width:100%; height:100%;
    padding:64px 76px;
    display:flex; flex-direction:column;
  }
  .top{ display:flex; align-items:center; justify-content:space-between; }
  .brand svg{ height:40px; width:auto; display:block; }
  .kicker{
    font-family:'JetBrains Mono',monospace; font-weight:500;
    font-size:16px; letter-spacing:0.18em; text-transform:uppercase;
    color:${T.accent};
  }
  .mid{ flex:1; display:flex; flex-direction:column; justify-content:center; gap:30px; padding-top:34px; }
  h1{
    font-family:'Inter Tight',sans-serif; font-weight:800;
    /* Starting point only. The fit pass below sets the final value. */
    font-size:52px; line-height:1.05; letter-spacing:-0.035em;
    max-width:20ch;
  }
  .accent{ color:${T.accent}; }
  .sub{
    font-size:22px; line-height:1.4; color:${T.fgMuted}; font-weight:400;
    max-width:38ch; margin-top:-12px;
  }
  .sub b{ color:${T.fg}; font-weight:600; }
  /* Two fact cards: the framework in node_modules, and the app served as
     written. Each pairs a mono eyebrow with a short benefit line, so the card
     stays scannable at timeline size while carrying the two-fact story. */
  .cards{ display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  .card{
    border:1px solid ${T.border}; border-radius:18px;
    background:${T.bgSubtle};
    padding:24px 26px; display:flex; flex-direction:column; gap:12px;
  }
  .clabel{
    display:flex; align-items:center; gap:9px;
    font-family:'JetBrains Mono',monospace; font-weight:500;
    font-size:14px; letter-spacing:0.1em; text-transform:uppercase; color:${T.accent};
  }
  .cnum{ color:${T.fgSubtle}; }
  .ctext{ font-size:21px; line-height:1.42; color:${T.fg}; font-weight:400; }
  .ctext .q{ color:${T.fgMuted}; }
  .mono{ font-family:'JetBrains Mono',monospace; font-size:0.86em; color:${T.fgMuted}; }
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
    <div class="top">
      <div class="brand">__LOCKUP__</div>
      <div class="kicker">Built for the AI era</div>
    </div>
    <div class="mid">
      <h1>${TITLE}</h1>
      <div class="sub">${SUB}</div>
      <div class="cards">
        ${FACTS.map(
          (f, i) => `<div class="card">
          <div class="clabel"><span class="cnum">0${i + 1}</span> ${f.label}</div>
          <div class="ctext">${f.text}</div>
        </div>`,
        ).join('\n        ')}
      </div>
    </div>
    <div>
      <hr>
      <div class="foot">
        <div class="tags"><span class="dot"></span>NO TRAINING DATA &nbsp;&middot;&nbsp; NO BUNDLER &nbsp;&middot;&nbsp; ANY MODEL</div>
        <div>github.com/webjsdev/webjs</div>
      </div>
    </div>
  </div>
</body></html>`;
const html = html0.replace('__LOCKUP__', LOCKUP_SVG);

const tmp = mkdtempSync(join(tmpdir(), 'webjs-og-why-'));
const big = join(tmp, 'og-2x.png');

const browser = await chromium.launch();
let titlePx;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  // Shrink the headline until the card holds it. This card is fuller than the
  // home one (a kicker, a sub, and two fact cards under the headline), so it
  // has the least slack and the most to lose from an edit that runs it over.
  titlePx = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const frame = document.querySelector('.frame');
    for (let px = 52; px >= 30; px -= 1) {
      h1.style.fontSize = px + 'px';
      if (frame.scrollHeight <= frame.clientHeight) return px;
    }
    return 30;
  });
  await page.screenshot({ path: big, clip: { x: 0, y: 0, width: 1200, height: 630 } });
} finally {
  await browser.close();
}
if (titlePx < 52) console.log(`Headline set at ${titlePx}px to fit the card.`);

// Downscale the 2400x1260 capture to an exact 1200x630 for crisp text, strip
// metadata, and use max PNG compression. PNG rather than WebP because it is the
// safe og:image format for every social unfurler.
execFileSync('magick', [big, '-resize', '1200x630', '-strip', '-define', 'png:compression-level=9', OUT], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
console.log('wrote', OUT);
