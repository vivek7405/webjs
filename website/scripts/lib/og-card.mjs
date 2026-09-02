/**
 * Shared pipeline for the 1200x630 social cards.
 *
 * There are three of them now (the home card, /what-is-webjs and /why-webjs),
 * and they differ only in their content and their middle block. Everything
 * around that is identical: the palette, the inlined faces, the lockup, the
 * frame, the footer, and the render itself. Three copies of that was the point
 * where a fix stopped landing on every card, which is exactly how the /why card
 * ended up carrying a retired logo and a claim the site had already corrected.
 *
 * So the SHELL lives here and each card owns only its own middle. This is not a
 * card framework: a card that wants a different structure writes its own CSS
 * and passes it in, which is what the /why card does for its two fact panels.
 *
 * The cards are LIGHT while the site is dark-first, and that is deliberate. A
 * social card is a static image with no theme to follow, rendered once and then
 * read inside someone else's surface: an X timeline, a Slack unfurl, an
 * iMessage bubble, a LinkedIn feed. Those surfaces are overwhelmingly light,
 * and a near-black card sits in them as a hole rather than as a card.
 *
 * Prerequisites: ImageMagick (the `magick` binary) on PATH. Playwright is a
 * website devDependency and resolves from node_modules.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The LIGHT half of the light-dark() token pairs in app/layout.ts, resolved
 * here because a static PNG has no light-dark() to resolve. Keep in lockstep
 * with that block.
 */
export const T = {
  bg: 'oklch(0.985 0.008 75)',
  bgSubtle: 'oklch(0.96 0.008 75)',
  fg: 'oklch(0.20 0.018 60)',
  fgMuted: 'oklch(0.44 0.02 60)',
  fgSubtle: 'oklch(0.50 0.02 65)',
  border: 'oklch(0.88 0.012 70)',
  accent: 'oklch(0.54 0.16 52)',
};

// Inlined as data URIs rather than fetched from Google Fonts, so a render has
// no network to fail and cannot silently ship a card set in a system fallback
// face. Same three files the site preloads, so a card and a page cannot show
// different type. Each is one variable file covering every weight.
const fontDataUri = (file) =>
  `data:font/woff2;base64,${readFileSync(resolve('public/fonts', file)).toString('base64')}`;

export const FONT_FACES = `
  @font-face{font-family:'Inter Tight';font-weight:100 900;src:url('${fontDataUri('inter-tight.woff2')}') format('woff2');}
  @font-face{font-family:'Inter';font-weight:100 900;src:url('${fontDataUri('inter.woff2')}') format('woff2');}
  @font-face{font-family:'JetBrains Mono';font-weight:100 800;src:url('${fontDataUri('jetbrains-mono.woff2')}') format('woff2');}
`;

// The REAL lockup file rather than a redrawn copy, for the same reason the site
// uses it: a redraw is how the logo drifted once already, and a card is where
// nobody notices, because it is generated once and then only ever seen inside
// somebody else's timeline. Inlined rather than <img> so the render has no
// file:// fetch to race.
export const LOCKUP = readFileSync(resolve('public/brand/webjs-lockup-on-light.svg'), 'utf8');

/** The frame, the accent bar and the footer, shared by every card. */
export const BASE_CSS = `
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ width:1200px; height:630px; }
  body{
    font-family:'Inter',system-ui,sans-serif;
    background:${T.bg};
    color:${T.fg};
    position:relative;
    overflow:hidden;
  }
  /* The one piece of colour that survives a thumbnail. Scaled into a timeline
     the headline is unreadable but the bar still reads as the brand's orange,
     which is what makes a card recognisable before it is legible. */
  .bar{ position:absolute; left:0; top:0; width:100%; height:10px; background:${T.accent}; }
  .frame{
    position:relative; z-index:1;
    width:100%; height:100%;
    display:flex; flex-direction:column;
  }
  .top{ display:flex; align-items:center; justify-content:space-between; }
  /* The middle block is spaced from BOTH neighbours here rather than in each
     card. When the cards owned it, buying clearance above the footer was paid
     for out of the gap under the lockup, and the headline collided with it. */
  .mid{
    flex:1; display:flex; flex-direction:column; justify-content:center;
    gap:26px; padding-top:30px;
  }
  .brand{ display:flex; align-items:center; }
  .brand svg{ height:40px; width:auto; display:block; }
  /* The kicker sits opposite the lockup on every card. It is the one line that
     says what the whole family is FOR, so it is not a per-card decision. */
  .kicker{
    font-family:'JetBrains Mono',monospace; font-weight:500;
    font-size:16px; letter-spacing:0.18em; text-transform:uppercase;
    color:${T.accent};
  }
  .accent{ color:${T.accent}; }
  .foot{
    display:flex; align-items:center; justify-content:space-between;
    font-family:'JetBrains Mono',monospace; font-weight:500;
    font-size:15px; letter-spacing:0.04em; color:${T.fgSubtle};
  }
  .foot .tags{ display:flex; align-items:center; gap:10px; text-transform:uppercase; }
  .dot{ width:7px; height:7px; border-radius:50%; background:${T.accent}; }
  /* Both sides, not just the one. With margin-bottom alone the rule kept its
     distance from the footer text and none at all from whatever the middle
     block ended on, so a card whose middle ends in a bordered panel had two
     lines nearly touching. The middle block is flex:1, so this space is taken
     from it rather than added to the card, and the fit pass absorbs the
     difference. */
  hr{ border:0; border-top:1px solid ${T.border}; margin-top:28px; margin-bottom:24px; }
`;

/**
 * Two fact panels, the structure that fills the lower half of a card.
 *
 * A card is 1200 wide and a headline capped at a readable measure uses maybe
 * half of it, so without something down here the right side reads as empty
 * rather than as space. Each panel pairs a mono eyebrow with one short line, so
 * the card stays scannable at the size a timeline actually renders it.
 *
 * Opt in by spreading PANEL_CSS into the card's own css and calling panels().
 * It is shared rather than built into the shell because a card is free not to
 * have them.
 */
export const PANEL_CSS = `
  .cards{ display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  .card{
    border:1px solid ${T.border}; border-radius:18px;
    background:${T.bgSubtle};
    padding:24px 26px; display:flex; flex-direction:column; gap:12px;
  }
  .clabel{
    font-family:'JetBrains Mono',monospace; font-weight:500;
    font-size:14px; letter-spacing:0.1em; text-transform:uppercase; color:${T.accent};
  }
  .ctext{ font-size:21px; line-height:1.42; color:${T.fg}; font-weight:400; }
  .ctext .q{ color:${T.fgMuted}; }
  .mono{ font-family:'JetBrains Mono',monospace; font-size:0.86em; color:${T.fgMuted}; }
`;

/** @param {{label:string,text:string}[]} facts */
export const panels = (facts) => `<div class="cards">
        ${facts
          .map(
            (f) => `<div class="card">
          <div class="clabel">${f.label}</div>
          <div class="ctext">${f.text}</div>
        </div>`,
          )
          .join('\n        ')}
      </div>`;

/**
 * Render one card to `out`.
 *
 * @param {object} o
 * @param {string} o.css      card-specific CSS, appended after BASE_CSS
 * @param {string} o.body     the card's middle block, between top row and footer
 * @param {string} [o.kicker] the mono line opposite the lockup
 * @param {string} o.tags     the mono footer strip, left of the repo url
 * @param {string} o.out      absolute output path
 * @param {{from:number,to:number}} [o.fit]  headline size range for the fit pass
 */
export async function renderCard({ css, body, tags, out, kicker = 'Built for the AI era', fit = { from: 70, to: 34 } }) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${FONT_FACES}${BASE_CSS}${css}</style></head>
<body>
  <div class="bar"></div>
  <div class="frame">
    <div class="top">
      <div class="brand">${LOCKUP}</div>
      <div class="kicker">${kicker}</div>
    </div>
    ${body}
    <div>
      <hr>
      <div class="foot">
        <div class="tags"><span class="dot"></span>${tags}</div>
        <div>github.com/webjsdev/webjs</div>
      </div>
    </div>
  </div>
</body></html>`;

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
    // ones keeps a short headline exactly as it was drawn and costs a longer
    // one as little size as it can.
    //
    // The test is the FOOTER's bottom against the frame's padding box, not
    // scrollHeight against clientHeight. That earlier test could never fail:
    // the frame is a fixed-height flex container and body is overflow:hidden,
    // so its scrollHeight is pinned to its clientHeight however far the content
    // spills. The loop returned on its first iteration every time, and the
    // cards had been quietly rendering their footers outside the bottom padding
    // (605px against a 566px limit on the fullest one) with nothing to say so.
    titlePx = await page.evaluate(({ from, to }) => {
      const h1 = document.querySelector('h1');
      const frame = document.querySelector('.frame');
      const foot = document.querySelector('.foot');
      const limit =
        frame.getBoundingClientRect().bottom - parseFloat(getComputedStyle(frame).paddingBottom);
      for (let px = from; px >= to; px -= 1) {
        h1.style.fontSize = px + 'px';
        // Half a pixel of tolerance, since both sides are fractional.
        if (foot.getBoundingClientRect().bottom <= limit + 0.5) return px;
      }
      return null;
    }, fit);
    await page.screenshot({ path: big, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  } finally {
    await browser.close();
  }
  // A null means even the smallest step overflowed, so the card needs less
  // CONTENT rather than smaller type. Loud, because the render still produces a
  // plausible-looking png with its footer cut off.
  if (titlePx === null) {
    console.warn(`WARNING: ${out} overflows at ${fit.to}px. Shorten the copy; the footer is clipped.`);
  } else if (titlePx < fit.from) {
    console.log(`Headline set at ${titlePx}px to fit the card.`);
  }

  // Downscale the 2400x1260 capture to an exact 1200x630 for crisp text, strip
  // metadata, and use max PNG compression. PNG rather than WebP because it is
  // the safe og:image format for every social unfurler.
  execFileSync('magick', [big, '-resize', '1200x630', '-strip', '-define', 'png:compression-level=9', out], { stdio: 'inherit' });
  rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', out);
}
