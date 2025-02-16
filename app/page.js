import { html } from "../utils/html-literal.js";

export default class RootPage extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <h1>Welcome to the Root Page</h1>
      <p>This content is server-rendered.</p>
      <div client-component="/components/Button.js">Click Me</div>
    `;
  }
}

customElements.define("root-page", RootPage);
