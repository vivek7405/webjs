import { html } from "../../utils/html-literal.js";

export default class HomeLayout extends HTMLElement {
  // constructor() {
  //   super();
  //   this.attachShadow({ mode: "open" });
  // }

  connectedCallback() {
    this.innerHTML = html`
      <div>
        <h2>Home Section</h2>
        <slot></slot>
      </div>
    `;
  }
}
customElements.define("home-layout", HomeLayout);
