import { html } from "../utils/html-literal.js";
import moment from "https://cdn.jsdelivr.net/npm/moment@2.30.1/+esm";

export default class Button extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = html`
      <style>
        button {
          padding: 0.5em 1em;
          color: white;
          background-color: #007bff;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }
        button:hover {
          background-color: #0056b3;
        }
      </style>

      <button id="clientButton">
        <!-- Accepts children passed to this component -->
        <slot></slot>
      </button>
    `;

    this.shadowRoot
      .getElementById("clientButton")
      .addEventListener("click", this.handleClick);
  }

  handleClick() {
    alert(
      `Client-only button clicked! Today's date is ${moment(new Date()).format(
        "DD/MM/YYYY"
      )}`
    );
  }
}

customElements.define("client-button", Button);
