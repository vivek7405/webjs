import {
  html,
  render,
} from "https://cdn.jsdelivr.net/npm/lit-html@latest/lit-html.min.js";

export default class LitHTMLHello extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    const htmlToRender = html`
      <style>
        p {
          padding: 0.5em 1em;
          color: orange;
        }
      </style>

      <p>
        <!-- Accepts children passed to this component -->
        <slot></slot>
      </p>
    `;

    render(htmlToRender, this.shadowRoot);

    // this.shadowRoot
    //   .getElementById("clientButton")
    //   .addEventListener("click", this.handleClick);
  }
}

customElements.define("lit-html-hello", LitHTMLHello);
