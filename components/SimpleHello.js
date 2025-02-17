import { html } from "../utils/html-literal.js";

export default class SimpleHello extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = html`
      <style>
        p {
          color: red;
        }
      </style>

      <p>
        <!-- Accepts children passed to this component -->
        <slot></slot>
      </p>
    `;

    // this.shadowRoot
    //   .getElementById("clientButton")
    //   .addEventListener("click", this.handleClick);
  }
}

customElements.define("simple-hello", SimpleHello);
