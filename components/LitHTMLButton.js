import {
  html,
  render,
} from "https://cdn.jsdelivr.net/npm/lit-html@latest/lit-html.min.js";

import moment from "https://cdn.jsdelivr.net/npm/moment@2.30.1/+esm";

export default class LitHTMLButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    const htmlToRender = html`
      <style>
        button {
          padding: 0.5em 1em;
          color: white;
          background-color:rgb(255, 34, 0);
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }
        button:hover {
          background-color:rgb(179, 3, 0);
        }
      </style>

      <button @click=${this.handleClick} id="clientButton">
        <!-- Accepts children passed to this component -->
        <slot></slot>
      </button>
    `;

    render(htmlToRender, this.shadowRoot);

    // this.shadowRoot
    //   .getElementById("clientButton")
    //   .addEventListener("click", this.handleClick);
  }

  handleClick() {
    alert(
      `Lit HTML Button rendered! Today's date is ${moment(new Date()).format(
        "DD/MM/YYYY"
      )}`
    );
  }
}

customElements.define("lit-html-button", LitHTMLButton);
