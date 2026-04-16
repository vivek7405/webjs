import { html } from 'webjs';

export const metadata = { title: 'Context Protocol — webjs' };

export default function Context() {
  return html`
    <h1>Context Protocol</h1>
    <p>The context protocol lets you share data across deeply nested components without threading attributes through every intermediate element. It uses DOM events under the hood, which means it works across shadow DOM boundaries — a provider at the top of the tree can reach consumers buried many levels deep.</p>

    <pre>import { createContext, ContextProvider, ContextConsumer } from 'webjs/context';</pre>

    <h2>When to Use Context</h2>
    <p>Context is the right tool when:</p>
    <ul>
      <li><strong>Theme / dark mode</strong> — a setting at the app root that dozens of components read.</li>
      <li><strong>Auth state</strong> — the current user object needed by nav bars, comment forms, profile widgets, etc.</li>
      <li><strong>Locale / i18n</strong> — language preference that affects every text-rendering component.</li>
      <li><strong>Feature flags</strong> — runtime configuration that controls conditional rendering deep in the tree.</li>
    </ul>

    <p>Context is <strong>not</strong> the right tool when:</p>
    <ul>
      <li>Data changes on every render — use component state instead.</li>
      <li>Only one component needs the data — pass it as an attribute or property.</li>
      <li>Data is page-level — use an async page function to fetch it on the server.</li>
    </ul>

    <h2>Creating a Context</h2>
    <p><code>createContext(name)</code> returns a unique context key. The name is for debugging — uniqueness comes from the object identity.</p>

    <pre>// contexts/theme.ts (or .js)
import { createContext } from 'webjs/context';

export const themeContext = createContext('theme');
export type Theme = 'light' | 'dark' | 'system';</pre>

    <p>Define your context keys in shared modules so both providers and consumers import the same object.</p>

    <h2>Providing a Value</h2>
    <p><code>ContextProvider</code> is a reactive controller that provides a value to all descendants. Attach it to any component:</p>

    <pre>import { WebComponent, html, css } from 'webjs';
import { ContextProvider } from 'webjs/context';
import { themeContext } from '../contexts/theme.ts';

class AppShell extends WebComponent {
  static tag = 'app-shell';

  static styles = css\`
    :host { display: block; }
  \`;

  #theme = new ContextProvider(this, {
    context: themeContext,
    initialValue: 'light',
  });

  toggleTheme() {
    const next = this.#theme.value === 'light' ? 'dark' : 'light';
    this.#theme.setValue(next);  // updates all subscribers
  }

  render() {
    return html\`
      &lt;header&gt;
        &lt;button @click=\${() =&gt; this.toggleTheme()}&gt;
          Toggle theme (current: \${this.#theme.value})
        &lt;/button&gt;
      &lt;/header&gt;
      &lt;main&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/main&gt;
    \`;
  }
}
AppShell.register(import.meta.url);</pre>

    <p>When you call <code>provider.setValue(newValue)</code>, every subscribed consumer is notified and its host component re-renders automatically.</p>

    <h2>Consuming a Value</h2>
    <p><code>ContextConsumer</code> is a reactive controller that reads the nearest provider's value. Attach it to any descendant component:</p>

    <pre>import { WebComponent, html, css } from 'webjs';
import { ContextConsumer } from 'webjs/context';
import { themeContext } from '../contexts/theme.ts';

class ThemedCard extends WebComponent {
  static tag = 'themed-card';

  static styles = css\`
    :host { display: block; padding: 16px; border-radius: 8px; }
    :host(.dark) { background: #1a1a2e; color: #eee; }
    :host(.light) { background: #fff; color: #222; border: 1px solid #ddd; }
  \`;

  #theme = new ContextConsumer(this, {
    context: themeContext,
    subscribe: true,  // re-render when the provider's value changes
  });

  render() {
    // Apply the theme as a class on the host element
    this.className = this.#theme.value ?? 'light';

    return html\`
      &lt;h3&gt;&lt;slot name="title"&gt;Card&lt;/slot&gt;&lt;/h3&gt;
      &lt;p&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/p&gt;
    \`;
  }
}
ThemedCard.register(import.meta.url);</pre>

    <h2>Subscribe vs One-Shot Mode</h2>
    <p>The <code>subscribe</code> option controls whether the consumer receives ongoing updates:</p>

    <h3>subscribe: true (default for most use cases)</h3>
    <p>The consumer re-renders whenever the provider calls <code>setValue()</code>. This is what you want for live data like theme, auth state, or locale.</p>

    <pre>// Consumer re-renders every time the provider's value changes
#theme = new ContextConsumer(this, {
  context: themeContext,
  subscribe: true,
});</pre>

    <h3>subscribe: false (one-shot)</h3>
    <p>The consumer reads the provider's value once during <code>connectedCallback</code> and never updates afterward. This is useful for configuration that is set once and never changes, like a base URL or API key:</p>

    <pre>// Consumer reads the value once and ignores future changes
#apiBase = new ContextConsumer(this, {
  context: apiBaseContext,
  subscribe: false,
});</pre>

    <p>With <code>subscribe: false</code>, calling <code>provider.setValue()</code> does not notify this consumer.</p>

    <h2>How It Works Under the Hood</h2>
    <p>The context protocol uses standard DOM events:</p>

    <ol>
      <li>When a consumer connects, it dispatches a <code>ContextRequestEvent</code> that bubbles up through the DOM (including across shadow DOM boundaries, since it is composed).</li>
      <li>The nearest ancestor with a matching <code>ContextProvider</code> intercepts the event.</li>
      <li>If <code>subscribe: true</code>, the provider stores a callback reference and calls it whenever <code>setValue()</code> is invoked.</li>
      <li>If <code>subscribe: false</code>, the provider responds with the current value and the event stops.</li>
    </ol>

    <p>This means context works with any DOM tree structure — including components from different libraries — as long as they follow the same context protocol. There is no framework-specific wiring.</p>

    <h2>Multiple Contexts</h2>
    <p>A single component can provide or consume multiple contexts:</p>

    <pre>import { createContext, ContextProvider } from 'webjs/context';

const themeContext = createContext('theme');
const localeContext = createContext('locale');
const authContext = createContext('auth');

class AppRoot extends WebComponent {
  static tag = 'app-root';

  #theme = new ContextProvider(this, {
    context: themeContext,
    initialValue: 'light',
  });

  #locale = new ContextProvider(this, {
    context: localeContext,
    initialValue: 'en',
  });

  #auth = new ContextProvider(this, {
    context: authContext,
    initialValue: null,
  });

  login(user) {
    this.#auth.setValue(user);
  }

  render() {
    return html\`&lt;slot&gt;&lt;/slot&gt;\`;
  }
}
AppRoot.register(import.meta.url);</pre>

    <h2>Nested Providers</h2>
    <p>Providers can be nested. A consumer resolves to the nearest ancestor provider with a matching context key:</p>

    <pre>&lt;app-root&gt;                  &lt;!-- provides theme: 'light' --&gt;
  &lt;themed-card&gt;             &lt;!-- consumes theme: 'light' --&gt;
  &lt;/themed-card&gt;

  &lt;dark-section&gt;             &lt;!-- provides theme: 'dark' (overrides) --&gt;
    &lt;themed-card&gt;           &lt;!-- consumes theme: 'dark' --&gt;
    &lt;/themed-card&gt;
  &lt;/dark-section&gt;
&lt;/app-root&gt;</pre>

    <p>This mirrors how CSS custom properties cascade — inner values shadow outer ones.</p>

    <h2>Full Example: Auth Context</h2>
    <p>A complete provider + consumer pair for authentication state:</p>

    <pre>// contexts/auth.ts
import { createContext } from 'webjs/context';
export const authContext = createContext('auth');

// components/auth-provider.ts
import { WebComponent, html } from 'webjs';
import { ContextProvider } from 'webjs/context';
import { authContext } from '../contexts/auth.ts';

class AuthProvider extends WebComponent {
  static tag = 'auth-provider';

  #auth = new ContextProvider(this, {
    context: authContext,
    initialValue: { user: null, loading: true },
  });

  async connectedCallback() {
    super.connectedCallback();
    try {
      const res = await fetch('/api/me');
      const user = res.ok ? await res.json() : null;
      this.#auth.setValue({ user, loading: false });
    } catch {
      this.#auth.setValue({ user: null, loading: false });
    }
  }

  render() {
    return html\`&lt;slot&gt;&lt;/slot&gt;\`;
  }
}
AuthProvider.register(import.meta.url);

// components/user-menu.ts
import { WebComponent, html } from 'webjs';
import { ContextConsumer } from 'webjs/context';
import { authContext } from '../contexts/auth.ts';

class UserMenu extends WebComponent {
  static tag = 'user-menu';

  #auth = new ContextConsumer(this, {
    context: authContext,
    subscribe: true,
  });

  render() {
    const { user, loading } = this.#auth.value ?? {};
    if (loading) return html\`&lt;span&gt;...&lt;/span&gt;\`;
    if (!user) return html\`&lt;a href="/login"&gt;Sign in&lt;/a&gt;\`;
    return html\`&lt;span&gt;Hi, \${user.name}&lt;/span&gt;\`;
  }
}
UserMenu.register(import.meta.url);</pre>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/controllers">Reactive Controllers</a> — the general pattern that ContextProvider and ContextConsumer are built on</li>
      <li><a href="/docs/task">Task Controller</a> — async data fetching with loading/error states</li>
      <li><a href="/docs/components">Components</a> — the full component API</li>
    </ul>
  `;
}
