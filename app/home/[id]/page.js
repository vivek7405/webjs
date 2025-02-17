import { html } from "../../../utils/html-literal.js";

export default class HomeContentPage extends HTMLElement {
  constructor() {
    super();
  }

  async connectedCallback() {
    // Access the dynamic route params through this.params
    const { id } = this.params;
    console.log("ID:", id);

    const response = await fetch(
      `https://jsonplaceholder.typicode.com/todos/${id}`
    );
    const todo = await response.json();

    this.innerHTML = html`
      <h1>Todo Details - ID: ${id}</h1>
      <div class="todo-details">
        <h2>${todo.title}</h2>
        <p>Completed: ${todo.completed ? "Yes" : "No"}</p>
      </div>

      <script type="module" src="/components/Button.js"></script>
      <client-button>Back</client-button>
    `;
  }
}

customElements.define("home-content-page", HomeContentPage);
