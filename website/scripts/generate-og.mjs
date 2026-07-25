/**
 * Regenerate public/og.png, the 1200x630 social card.
 *
 * Manual dev tool, not part of the build or deploy. It renders an on-brand
 * dark card with headless Chromium (Playwright) at 2x, then downscales to an
 * exact 1200x630 with ImageMagick for crisp text. Run it whenever the headline
 * or look changes:
 *
 *   node scripts/generate-og.mjs
 *
 * Prerequisites: ImageMagick (the `magick` binary) on PATH. Playwright is a
 * website devDependency (shared with the browser-test toolchain) and resolves
 * from node_modules. ImageMagick is the only external, non-npm tool. The card
 * mirrors the dark-theme design tokens declared in
 * app/layout.ts
 * (background, foreground, accent, the warm accent glow), so a regenerated card
 * always matches the live site's look.
 *
 * The copy is deliberately BENEFIT-led rather than a copy of the hero headline:
 * a social card is read in a timeline by someone who has never heard of WebJs,
 * so it answers "what do I get" (production-ready code out of any model, small
 * or large, with no training data) before "how does it work". The mechanism
 * lives on the page. The card sells the outcome.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'public/og.png');

// Dark-theme tokens, copied from the :root[data-theme='dark'] block in
// app/layout.ts so the card and the site stay in lockstep (pure-black
// surfaces, warm hue-52 accent).
const T = {
  bg: 'oklch(0 0 0)',
  bgDeep: 'oklch(0.135 0 0)',
  fg: 'oklch(0.96 0 0)',
  fgMuted: 'oklch(0.74 0 0)',
  fgSubtle: 'oklch(0.62 0 0)',
  accent: 'oklch(0.7 0.16 52)',
  accentLive: 'oklch(0.63 0.17 50)',
  border: 'oklch(0.32 0 0 / 0.9)',
  // The logo mark stops, copied from the dark-theme --logo-from/--logo-to in
  // app/layout.ts. An OG card is not theme-adaptive (social unfurlers render
  // one static image), so the dark card carries the DARK navbar mark.
  logoFrom: 'oklch(0.8 0.16 58)',
  logoTo: 'oklch(0.62 0.18 44)',
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Inter:wght@400;500&family=JetBrains+Mono:wght@500&display=swap">
<style>
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ width:1200px; height:630px; }
  body{
    font-family:'Inter',system-ui,sans-serif;
    background:${T.bg};
    color:${T.fg};
    position:relative;
    overflow:hidden;
  }
  .glow{
    position:absolute; inset:0; pointer-events:none;
    background:
      radial-gradient(58% 50% at 50% -8%, color-mix(in oklch, ${T.accentLive} 26%, transparent), transparent 72%),
      radial-gradient(46% 42% at 90% 6%, color-mix(in oklch, ${T.accentLive} 20%, transparent), transparent 70%),
      radial-gradient(70% 60% at 50% 120%, ${T.bgDeep}, transparent 60%);
  }
  .frame{
    position:relative; z-index:1;
    width:100%; height:100%;
    padding:72px 76px;
    display:flex; flex-direction:column;
  }
  .brand{ display:flex; align-items:center; gap:16px; }
  .mark{
    width:46px; height:46px; border-radius:15px;
    background:linear-gradient(135deg, ${T.logoFrom}, ${T.logoTo});
    box-shadow:0 6px 22px color-mix(in oklch, ${T.logoFrom} 40%, transparent),
               inset 0 1px 0 color-mix(in oklch, white 30%, transparent);
  }
  .word{ font-family:'Inter Tight',sans-serif; font-weight:700; font-size:31px; letter-spacing:-0.02em; }
  .mid{ flex:1; display:flex; flex-direction:column; justify-content:center; gap:34px; padding-top:40px; }
  h1{
    font-family:'Inter Tight',sans-serif; font-weight:800;
    font-size:52px; line-height:1.05; letter-spacing:-0.035em;
    max-width:20ch;
  }
  .accent{
    white-space:nowrap;
    background:linear-gradient(105deg, ${T.accent}, color-mix(in oklch, ${T.accentLive} 72%, ${T.fg}));
    -webkit-background-clip:text; background-clip:text; color:transparent;
  }
  p.lede{
    margin-top:-12px; max-width:48ch;
    font-size:22px; line-height:1.4; color:${T.fgMuted};
  }
  p.lede b{ color:${T.fg}; font-weight:600; }
  /* Two benefit cards, sharing the /why card's grid so the two social cards
     read as one system. The split here is deliberately broader than /why's
     (which argues the model-agnostic case): this is the site-wide default card,
     also serving /blog, /articles and /compare, so one card covers what the
     agent gets and the other what the shipped app gets. */
  .cards{ display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  .card{
    border:1px solid ${T.border}; border-radius:18px;
    background:color-mix(in oklch, ${T.bgDeep} 60%, transparent);
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
  <div class="glow"></div>
  <div class="frame">
    <div class="brand"><div class="mark"></div><div class="word">webjs</div></div>
    <div class="mid">
      <h1>Any AI model. <span class="accent">Production-ready code.</span></h1>
      <p class="lede">A full-stack web framework that needs <b>no training data</b>. Small models and large ones both ship code that works.</p>
      <div class="cards">
        <div class="card">
          <div class="clabel"><span class="cnum">01</span> What your agent gets</div>
          <div class="ctext">The whole stack fits in context. <span class="q">Plain JS in <span class="mono">node_modules</span>, built on the web components and forms every model already knows.</span></div>
        </div>
        <div class="card">
          <div class="clabel"><span class="cnum">02</span> What you ship</div>
          <div class="ctext">Server-rendered HTML that works without JavaScript. <span class="q">No bundler in between, on Node 24+ or Bun.</span></div>
        </div>
      </div>
    </div>
    <div>
      <hr>
      <div class="foot">
        <div class="tags"><span class="dot"></span>MODEL AGNOSTIC &nbsp;&middot;&nbsp; NO TRAINING DATA &nbsp;&middot;&nbsp; NO BUILD</div>
        <div>github.com/webjsdev/webjs</div>
      </div>
    </div>
  </div>
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), 'webjs-og-'));
const big = join(tmp, 'og-2x.png');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: big, clip: { x: 0, y: 0, width: 1200, height: 630 } });
} finally {
  await browser.close();
}

// Downscale the 2400x1260 capture to an exact 1200x630 for crisp text, and
// losslessly optimize: strip metadata and use max PNG compression. Lossy
// quantization / WebP are deliberately avoided here: the card is gradient-heavy
// (low color counts band the soft radials) and PNG is the safe og:image format
// for every social unfurler.
execFileSync('magick', [big, '-resize', '1200x630', '-strip', '-define', 'png:compression-level=9', OUT], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
console.log('wrote', OUT);
