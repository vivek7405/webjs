/**
 * Regenerate public/og.png, the site-wide 1200x630 social card.
 *
 * Manual dev tool, not part of the build or deploy. Run it whenever the
 * headline, the tagline or the palette changes:
 *
 *   node scripts/generate-og.mjs
 *
 * The shell (palette, faces, lockup, top row, panels, footer, render) lives in
 * scripts/lib/og-card.mjs and is shared with the other two cards. Only this
 * card's own content is here. See that file for why the cards are light while
 * the site is dark-first.
 */
import { resolve } from 'node:path';
import { T, PANEL_CSS, panels, renderCard } from './lib/og-card.mjs';

// The promise, verbatim from the homepage hero and the site-wide meta
// description. One string on every surface, so a shared link and the page it
// opens say the same sentence.
const TITLE = 'Production-ready architecture from your very first prompt';
// Accented through the first two words only. The whole headline in accent
// competes with the lockup above it, and accenting the tail buries the
// differentiating claim in the colour the eye reaches last.
const TITLE_HTML = TITLE.replace('Production-ready', '<span class="accent">Production-ready</span>');

// What the thing IS, under what it PROMISES. The lockup already says the name,
// so the sentence opens on the category instead of repeating it.
const SUB = '<b>A full-stack JavaScript web components framework</b> with no build step.';

// The two halves of the promise above, each stated as something checkable. The
// first is the site's own account of what a scaffold decides for you; the
// second is what "no build step" means in practice rather than as a slogan.
const FACTS = [
  {
    label: 'From one prompt',
    text: 'The architecture, a real database and a design system <span class="q">arrive without being specified.</span>',
  },
  {
    label: 'What you ship',
    text: 'Source files are served as native ES modules, <span class="q">so what you write is what runs.</span>',
  },
];

// Three claims, so the strip cannot afford a repeated suffix: this read
// "AI-FIRST / WEB-COMPONENTS-FIRST / NO BUILD", and two of them ending the same
// way landed as a tic rather than as two separate stances. "-first" was also
// the wrong word for the middle one. Web components are not a preference this
// framework ranks highly, they are its component model, the way Next is
// React-based rather than React-first. As a bare fact it matches the register
// of NO BUILD beside it. The hyphens went with the suffix, since they only ever
// bound the compound modifier and the platform feature is two plain words.
const TAGS = 'AI-FIRST &nbsp;&middot;&nbsp; WEB COMPONENTS &nbsp;&middot;&nbsp; NO BUILD';

await renderCard({
  out: resolve(process.argv[2] || 'public/og.png'),
  fit: { from: 52, to: 30 },
  css: `${PANEL_CSS}
  .frame{ padding:56px 76px; }
  h1{
    font-family:'Inter Tight',sans-serif; font-weight:800;
    /* Set by the fit pass, so this is a starting point rather than the
       designed size. */
    font-size:52px; line-height:1.05; letter-spacing:-0.035em;
    max-width:22ch;
  }
  .sub{
    font-size:22px; line-height:1.4; color:${T.fgMuted}; font-weight:400;
    max-width:40ch; margin-top:-12px;
  }
  .sub b{ color:${T.fg}; font-weight:600; }`,
  body: `<div class="mid">
      <h1>${TITLE_HTML}</h1>
      <div class="sub">${SUB}</div>
      ${panels(FACTS)}
    </div>`,
  tags: TAGS,
});
