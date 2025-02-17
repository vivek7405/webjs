import { html } from "../utils/html-literal.js";

export default class RootLayout extends HTMLElement {
  // constructor() {
  //   super();
  //   this.attachShadow({ mode: "open" });
  // }

  connectedCallback() {
    this.innerHTML = html`
      <div>
        <nav>
          <a href="/" data-link>Root</a>
          <a href="/home" data-link>Home</a>
          <a href="/about" data-link>About</a>
        </nav>
        <slot></slot>
      </div>
    `;
  }
}
customElements.define("root-layout", RootLayout);
