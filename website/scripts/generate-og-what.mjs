/**
 * Regenerate public/og-what.png, the 1200x630 social card for /what-is-webjs.
 *
 *   node scripts/generate-og-what.mjs
 *
 * That page had no card of its own and unfurled with the site-wide og.png,
 * whose headline is the product tagline. It is the page built to answer one
 * question (exact-match title, h1 and slug, a definition in the first 160
 * characters, a visible FAQ backing FAQPage JSON-LD), so it is the likeliest of
 * the three to be shared AS an answer, and it was the one arriving under a card
 * that answered something else.
 *
 * The shell (palette, faces, lockup, top row, panels, footer, render) lives in
 * scripts/lib/og-card.mjs and is shared with the other two cards. Only this
 * card's own content is here.
 */
import { resolve } from 'node:path';
import { T, PANEL_CSS, panels, renderCard } from './lib/og-card.mjs';

// The page's own h1, which is also its <title> and its URL slug. The whole
// point of the page is that those three match the question, so the card has no
// business paraphrasing it.
const TITLE = 'What is <span class="accent">WebJs</span>?';

// The definition sentence from the page, which is also the first 160 characters
// of its meta description, so the card and the search result agree.
const SUB = '<b>An AI-first full-stack JavaScript web framework built on web components,</b> server-rendered with no build step.';

// The definition above says what it IS. These say what that MEANS, and they
// carry the feature terms the site-wide meta description gave up to fit.
const FACTS = [
  {
    label: 'Every page',
    text: 'Server-rendered to real HTML. <span class="q">It reads, navigates and submits before a single script runs.</span>',
  },
  {
    label: 'Every component',
    text: 'A native custom element. <span class="q">Server actions and file-based routing, on Node 24+ or Bun.</span>',
  },
];

const TAGS = 'WEB COMPONENTS &nbsp;&middot;&nbsp; SSR &nbsp;&middot;&nbsp; NO BUILD STEP';

await renderCard({
  out: resolve(process.argv[2] || 'public/og-what.png'),
  fit: { from: 62, to: 30 },
  css: `${PANEL_CSS}
  .frame{ padding:64px 76px; }
  .mid{ flex:1; display:flex; flex-direction:column; justify-content:center; gap:30px; padding-top:34px; }
  h1{
    font-family:'Inter Tight',sans-serif; font-weight:800;
    /* Starts larger than the other two because this headline is four words and
       has room the others do not. The fit pass still owns the final value. */
    font-size:62px; line-height:1.05; letter-spacing:-0.035em;
    max-width:20ch;
  }
  .sub{
    font-size:22px; line-height:1.4; color:${T.fgMuted}; font-weight:400;
    max-width:40ch; margin-top:-12px;
  }
  .sub b{ color:${T.fg}; font-weight:600; }`,
  body: `<div class="mid">
      <h1>${TITLE}</h1>
      <div class="sub">${SUB}</div>
      ${panels(FACTS)}
    </div>`,
  tags: TAGS,
});
