import { html } from "../utils/html-literal.js";

export default class RootPage extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <h1>Welcome to the Root Page</h1>
      <p>This content is server-rendered.</p>

      <script type="module" src="/components/Button.js"></script>
      <client-button>Click Me</client-button>
    `;
  }
}

customElements.define("root-page", RootPage);
