/**
 * Regenerate public/og-why.png, the 1200x630 social card for /why-webjs.
 *
 *   node scripts/generate-og-why.mjs
 *
 * The shell (palette, faces, lockup, top row, panels, footer, render) lives in
 * scripts/lib/og-card.mjs and is shared with the other two cards. Only this
 * card's own content is here.
 */
import { resolve } from 'node:path';
import { T, PANEL_CSS, panels, renderCard } from './lib/og-card.mjs';

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
const SUB = '<b>A full-stack JavaScript framework</b> with no build step, so nothing is hidden from your agent.';

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

const TAGS = 'NO TRAINING DATA &nbsp;&middot;&nbsp; NO BUNDLER &nbsp;&middot;&nbsp; ANY MODEL';

await renderCard({
  out: resolve(process.argv[2] || 'public/og-why.png'),
  // This card is the fullest of the three (a headline, a sub and two panels),
  // so it has the least slack and the most to lose from an edit that runs it
  // over.
  fit: { from: 52, to: 30 },
  css: `${PANEL_CSS}
  .frame{ padding:64px 76px; }
  .mid{ flex:1; display:flex; flex-direction:column; justify-content:center; gap:30px; padding-top:34px; }
  h1{
    font-family:'Inter Tight',sans-serif; font-weight:800;
    font-size:52px; line-height:1.05; letter-spacing:-0.035em;
    max-width:20ch;
  }
  .sub{
    font-size:22px; line-height:1.4; color:${T.fgMuted}; font-weight:400;
    max-width:38ch; margin-top:-12px;
  }
  .sub b{ color:${T.fg}; font-weight:600; }`,
  body: `<div class="mid">
      <h1>${TITLE}</h1>
      <div class="sub">${SUB}</div>
      ${panels(FACTS)}
    </div>`,
  tags: TAGS,
});
