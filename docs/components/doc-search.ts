import { WebComponent, html } from 'webjs';

type Result = { path: string; title: string; score: number; snippet: string };

/**
 * `<doc-search>` — search input + dropdown results. Light DOM + Tailwind.
 */
export class DocSearch extends WebComponent {
  declare state: { query: string; results: Result[]; loading: boolean; open: boolean };
  _timer: any = null;

  constructor() {
    super();
    this.state = { query: '', results: [], loading: false, open: false };
  }

  onInput(e: InputEvent) {
    const val = (e.target as HTMLInputElement).value;
    this.setState({ query: val, open: true });
    clearTimeout(this._timer);
    if (val.trim().length < 2) {
      this.setState({ results: [], loading: false });
      return;
    }
    this.setState({ loading: true });
    this._timer = setTimeout(() => this.search(val), 200);
  }

  async search(q: string) {
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const results: Result[] = await r.json();
      if (this.state.query === q) {
        this.setState({ results, loading: false });
      }
    } catch {
      this.setState({ loading: false });
    }
  }

  onBlur() {
    setTimeout(() => this.setState({ open: false }), 150);
  }

  onFocus() {
    if (this.state.query.length >= 2) this.setState({ open: true });
  }

  navigate(path: string) {
    this.setState({ open: false, query: '' });
    if (typeof (window as any).navigate === 'function') {
      (window as any).navigate(path);
    } else {
      location.href = path;
    }
  }

  render() {
    const { query, results, loading, open } = this.state;
    return html`
      <div class="block relative mb-4">
        <svg class="absolute left-[10px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-fg-subtle pointer-events-none"
             viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input
          class="w-full font-sans text-[13px] leading-[1.4] py-2 pr-3 pl-8 border border-border rounded-lg bg-bg-elev text-fg outline-none transition-colors duration-fast focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-tint)] placeholder:text-fg-subtle"
          type="search"
          placeholder="Search docs…"
          .value=${query}
          @input=${(e: InputEvent) => this.onInput(e)}
          @focus=${() => this.onFocus()}
          @blur=${() => this.onBlur()}
        />
        ${open && query.length >= 2 ? html`
          <div class="absolute top-[calc(100%+4px)] left-0 right-0 bg-bg-elev border border-border rounded-lg shadow-lg z-50 max-h-[360px] overflow-y-auto">
            ${loading ? html`<div class="p-3 text-center text-[13px] text-fg-subtle">Searching…</div>` :
              results.length === 0 ? html`<div class="p-3 text-center text-[13px] text-fg-subtle">No results for "${query}"</div>` :
              results.map(r => html`
                <a class="block p-2.5 px-3 no-underline text-fg border-b border-border last:border-b-0 transition-colors duration-fast hover:bg-accent-tint"
                   href=${r.path}
                   @click=${(e: Event) => { e.preventDefault(); this.navigate(r.path); }}>
                  <div class="font-semibold text-[13px] mb-0.5">${r.title}</div>
                  <div class="text-[12px] text-fg-muted leading-[1.4] overflow-hidden whitespace-nowrap text-ellipsis">${r.snippet}</div>
                </a>
              `)}
          </div>
        ` : ''}
      </div>
    `;
  }
}
DocSearch.register('doc-search');
