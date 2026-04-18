import { WebComponent, html, css } from 'webjs';

type Result = { path: string; title: string; score: number; snippet: string };

export class DocSearch extends WebComponent {
  static styles = css`
    :host { display: block; margin-bottom: var(--sp-4); }
    .wrap { position: relative; }
    input {
      width: 100%;
      padding: 8px 12px 8px 32px;
      font: 13px/1.4 var(--font-sans);
      border: 1px solid var(--border);
      border-radius: var(--rad);
      background: var(--bg-elev);
      color: var(--fg);
      outline: 0;
      transition: border-color var(--t-fast), box-shadow var(--t-fast);
    }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
    input::placeholder { color: var(--fg-subtle); }
    .icon {
      position: absolute;
      left: 10px; top: 50%;
      transform: translateY(-50%);
      width: 14px; height: 14px;
      color: var(--fg-subtle);
    }
    .results {
      position: absolute;
      top: calc(100% + 4px);
      left: 0; right: 0;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad);
      box-shadow: var(--shadow);
      z-index: 50;
      max-height: 360px;
      overflow-y: auto;
    }
    .results:empty { display: none; }
    .result {
      display: block;
      padding: 10px 12px;
      text-decoration: none;
      color: var(--fg);
      border-bottom: 1px solid var(--border);
      transition: background var(--t-fast);
    }
    .result:last-child { border-bottom: 0; }
    .result:hover { background: var(--accent-tint); }
    .result .title {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 2px;
    }
    .result .snippet {
      font-size: 12px;
      color: var(--fg-muted);
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      padding: 12px;
      text-align: center;
      font-size: 13px;
      color: var(--fg-subtle);
    }
  `;

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
    // Use the client router if available
    if (typeof (window as any).navigate === 'function') {
      (window as any).navigate(path);
    } else {
      location.href = path;
    }
  }

  render() {
    const { query, results, loading, open } = this.state;
    return html`
      <div class="wrap">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input
          type="search"
          placeholder="Search docs…"
          .value=${query}
          @input=${(e: InputEvent) => this.onInput(e)}
          @focus=${() => this.onFocus()}
          @blur=${() => this.onBlur()}
        />
        ${open && query.length >= 2 ? html`
          <div class="results">
            ${loading ? html`<div class="empty">Searching…</div>` :
              results.length === 0 ? html`<div class="empty">No results for "${query}"</div>` :
              results.map(r => html`
                <a class="result" href=${r.path} @click=${(e: Event) => { e.preventDefault(); this.navigate(r.path); }}>
                  <div class="title">${r.title}</div>
                  <div class="snippet">${r.snippet}</div>
                </a>
              `)}
          </div>
        ` : ''}
      </div>
    `;
  }
}
DocSearch.register('doc-search');
