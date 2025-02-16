import { html } from "../utils/html-literal.js";

export default class Header extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`<header><h1>Shared Header Component</h1></header>`;
  }
}

customElements.define("shared-header", Header);
