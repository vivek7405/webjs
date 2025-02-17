import {
  html,
  css,
  LitElement,
} from "https://cdn.jsdelivr.net/npm/lit@3.2.1/+esm";

export class SimpleGreeting extends LitElement {
  static styles = css`
    p {
      color: blue;
    }
  `;

  static properties = {
    name: { type: String },
  };

  constructor() {
    super();
    this.name = "Somebody";
  }

  render() {
    return html`<p>Hello, ${this.name}!</p>`;
  }
}
customElements.define("simple-greeting", SimpleGreeting);
