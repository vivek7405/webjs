import { html } from "../../utils/html-literal.js";

export default class HomePage extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  async connectedCallback() {
    const response = await fetch(
      "https://jsonplaceholder.typicode.com/todos/1"
    );
    const json = await response.json();
    // .then(response => response.json())
    // .then(json => console.log(json))
    this.shadowRoot.innerHTML = html`
      <h1>Welcome to the Home Page</h1>
      <p>This content is server-rendered.</p>
      <p>Below content is from API:</p>
      <p>{${JSON.stringify(json)}}</p>
      <div client-component="/components/Button.js">Click Me</div>
    `;
  }
}

customElements.define("home-page", HomePage);
