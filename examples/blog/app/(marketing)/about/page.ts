import { html } from 'webjs';
import { rubric, displayH1, codeChip } from '../../_utils/ui.ts';

export const metadata = { title: 'About — webjs blog' };

const FEATURES = [
  { label: 'SSR + DSD',            note: 'Real server HTML; shadow DOM upgrades on connect.' },
  { label: 'Streaming Suspense',   note: 'Fallback flushes immediately; deferred content streams in.' },
  { label: 'Server actions',       note: 'Import a .server.js fn from a component — auto-RPCs.' },
  { label: 'WebSockets',           note: 'Live chat and live comments via WS on route.js.' },
  { label: 'Session auth',         note: 'scrypt + cookie session, CSRF on RPC, rate-limited endpoints.' },
  { label: 'Fine-grained render',  note: 'Focus and selection survive state updates.' },
  { label: 'Keyed lists',          note: 'repeat() preserves element identity on reorder.' },
  { label: 'Route groups',         note: 'This page lives in app/(marketing)/about.' },
];

export default function About() {
  return html`
    ${rubric('about')}
    ${displayH1('A full-stack demo, at framework scale.')}
    <p class="text-[1.15rem] leading-[1.5] font-sans text-fg-muted max-w-[56ch] m-0 mb-18">
      A tiny blog built on <strong class="text-fg">webjs</strong> — a no-build, web-components-first,
      NextJs-inspired framework. Every feature the framework ships with is exercised
      here in under a thousand lines.
    </p>

    <h2 class="font-serif text-[1.6rem] tracking-[-0.02em] mt-18 mb-4">What's on display</h2>
    <div class="grid gap-0 border-t border-border">
      ${FEATURES.map((f) => html`
        <div class="grid grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)] gap-6 py-4 border-b border-border min-w-0">
          <div class="font-mono text-[11px] leading-[1.4] font-semibold tracking-[0.1em] text-accent uppercase">${f.label}</div>
          <p class="font-serif text-base leading-[1.6] text-fg m-0">${f.note}</p>
        </div>
      `)}
    </div>

    <div class="mt-12 px-8 py-6 bg-bg-elev border border-border rounded-[14px]">
      <p class="m-0 text-[15px] text-fg-muted">
        <strong class="text-fg">Modules architecture.</strong> Feature modules live under
        ${codeChip('modules/')} with their own ${codeChip('actions/')}, ${codeChip('queries/')},
        ${codeChip('components/')}, and ${codeChip('types.js')}. Routes in ${codeChip('app/')}
        are thin adapters.
      </p>
    </div>

    <p class="mt-12">
      <a href="/" class="text-accent underline underline-offset-[3px] decoration-transparent hover:decoration-current transition-colors duration-fast">← Back to posts</a>
    </p>
  `;
}
