/**
 * Shared FAQ convention parser for markdown content (comparisons; blog
 * posts may use it too, though they currently carry no FAQ).
 *
 * An author writes an FAQ as a `## FAQ` section near the end of the body,
 * with each question a `### <question>` heading followed by its answer
 * paragraphs, up to the next `###` or `##`:
 *
 *   ## FAQ
 *
 *   ### Is WebJs production ready?
 *   Yes, with caveats. ...
 *
 *   ### Does it need a build step?
 *   No. ...
 *
 * `parseFaq` returns the structured `{ question, answer }` pairs so a page
 * can BOTH render the visible FAQ and emit a matching `FAQPage` JSON-LD
 * block. Deriving both from the same source is what keeps the structured
 * data honest (Google discounts FAQ schema that is not visible on the page).
 *
 * Browser-safe (pure string work, no node:fs); the `.server.ts` queries
 * that read the files import it.
 */
export type FaqItem = { question: string; answer: string };

export function parseFaq(body: string): FaqItem[] {
  // Isolate the `## FAQ` section (case-insensitive), up to the next `## `.
  const start = body.search(/^##\s+FAQ\s*$/im);
  if (start < 0) return [];
  const after = body.slice(start).replace(/^##\s+FAQ\s*$/im, '');
  const end = after.search(/^##\s+(?!#)/m);
  const section = end < 0 ? after : after.slice(0, end);

  const items: FaqItem[] = [];
  // Split on `### ` question headings; the first chunk is pre-question noise.
  const parts = section.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const question = (nl < 0 ? part : part.slice(0, nl)).trim();
    const answer = (nl < 0 ? '' : part.slice(nl + 1)).trim().replace(/\s+/g, ' ');
    if (question && answer) items.push({ question, answer });
  }
  return items;
}

/**
 * A `FAQPage` schema.org object built from parsed FAQ items, ready to pass
 * to a page's `metadata.jsonLd`. Returns `null` when there are no items so
 * a caller can conditionally spread it.
 */
export function faqJsonLd(items: FaqItem[]): Record<string, unknown> | null {
  if (!items.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: { '@type': 'Answer', text: it.answer },
    })),
  };
}
