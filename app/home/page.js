import { html } from "../../utils/html-literal.js";
import "../../components/Header.js";

export default class HomePage extends HTMLElement {
  constructor() {
    super();
  }

  async connectedCallback() {
    const response = await fetch(
      "https://jsonplaceholder.typicode.com/todos/1"
    );
    const json = await response.json();

    const notAsync = "This is not async";

    const response2 = await fetch(
      "https://jsonplaceholder.typicode.com/todos/2"
    );
    const json2 = await response2.json();

    this.innerHTML = html`
      <shared-header></shared-header>

      <h1>Welcome to the Home Page</h1>
      <p>This content is server-rendered.</p>
      <p>Below content is from API:</p>
      <p>{${JSON.stringify(json)}}</p>
      <p>{${JSON.stringify(json2)}}</p>
      <p>${notAsync}</p>

      <script type="module" src="/components/Button.js"></script>
      <client-button>Click Me</client-button>
    `;
  }
}

customElements.define("home-page", HomePage);
