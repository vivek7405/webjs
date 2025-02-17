import { html } from "../../utils/html-literal.js";

export default class AboutPage extends HTMLElement {
  constructor() {
    super();
    // this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.innerHTML = html`
      <style>
        .about-us-header {
          color: "pink";
        }
      </style>

      <h1 class="about-us-header">About Us</h1>
      <p>Learn more about us here.</p>
    `;
  }
}

customElements.define("about-page", AboutPage);
