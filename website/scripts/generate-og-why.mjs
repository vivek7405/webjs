/**
 * Regenerate public/og-why.png, the 1200x630 social card for the /why pitch page.
 *
 * A sibling of scripts/generate-og.mjs (the home-page card): same dark, on-brand
 * look and the same render pipeline (headless Chromium at 2x, downscaled to an
 * exact 1200x630 with ImageMagick for crisp text), but with the pitch page's
 * AI-era headline and tags. Run it whenever the /why headline or look changes:
 *
 *   node scripts/generate-og-why.mjs
 *
 * Prerequisites: ImageMagick (the `magick` binary) on PATH. Playwright is a
 * website devDependency and resolves from node_modules. The tokens below are
 * copied from the :root[data-theme='dark'] block in app/layout.ts so the card
 * and the site stay in lockstep.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'public/og-why.png');

// Dark-theme tokens, copied from app/layout.ts. An OG card is not
// theme-adaptive (social unfurlers render one static image), so it carries the
// dark surfaces and the dark navbar logo mark.
const T = {
  bg: 'oklch(0 0 0)',
  bgDeep: 'oklch(0.135 0 0)',
  fg: 'oklch(0.96 0 0)',
  fgMuted: 'oklch(0.74 0 0)',
  fgSubtle: 'oklch(0.62 0 0)',
  accent: 'oklch(0.7 0.16 52)',
  accentLive: 'oklch(0.63 0.17 50)',
  border: 'oklch(0.32 0 0 / 0.9)',
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
  .kicker{
    font-family:'JetBrains Mono',monospace; font-weight:500;
    font-size:16px; letter-spacing:0.18em; text-transform:uppercase;
    color:${T.accent};
  }
  .top{ display:flex; align-items:center; justify-content:space-between; }
  .mid{ flex:1; display:flex; flex-direction:column; justify-content:center; gap:34px; padding-top:40px; }
  h1{
    font-family:'Inter Tight',sans-serif; font-weight:800;
    font-size:52px; line-height:1.05; letter-spacing:-0.035em;
    max-width:20ch;
  }
  .sub{
    font-size:22px; line-height:1.4; color:${T.fgMuted}; font-weight:400;
    max-width:34ch; margin-top:-14px;
  }
  .sub b{ color:${T.fg}; font-weight:600; }
  .accent{
    background:linear-gradient(105deg, ${T.accent}, color-mix(in oklch, ${T.accentLive} 72%, ${T.fg}));
    -webkit-background-clip:text; background-clip:text; color:transparent;
  }
  /* Two fact cards: the framework in node_modules, and the app served as
     written. Each pairs a mono eyebrow with a short benefit line, so the card
     stays scannable at timeline size while carrying the two-fact story. */
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
  .ctext b{ font-weight:600; }
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
    <div class="top">
      <div class="brand"><div class="mark"></div><div class="word">webjs</div></div>
      <div class="kicker">Built for the AI era</div>
    </div>
    <div class="mid">
      <h1>The framework your <span class="accent">AI agent</span> already understands</h1>
      <div class="sub">A <b>full-stack JavaScript framework</b> your AI agent can read end to end.</div>
      <div class="cards">
        <div class="card">
          <div class="clabel"><span class="cnum">01</span> Framework source</div>
          <div class="ctext">No build, <span class="mono">node_modules</span> holds plain JS. <span class="q">The agent reads the whole framework and fits it into context.</span></div>
        </div>
        <div class="card">
          <div class="clabel"><span class="cnum">02</span> Your app code</div>
          <div class="ctext">Served to the browser as written. <span class="q">The agent debugs the running app against the real source, not a bundle.</span></div>
        </div>
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

const tmp = mkdtempSync(join(tmpdir(), 'webjs-og-why-'));
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

// Downscale the 2400x1260 capture to an exact 1200x630 for crisp text, strip
// metadata, and use max PNG compression (PNG is the safe og:image format for
// every social unfurler, and the gradient-heavy card bands under lossy codecs).
execFileSync('magick', [big, '-resize', '1200x630', '-strip', '-define', 'png:compression-level=9', OUT], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
console.log('wrote', OUT);
