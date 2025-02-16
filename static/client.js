// Load Client Components
async function loadClientComponents() {
  document
    .querySelectorAll("[client-component]")
    .forEach(async (placeholder) => {
      const componentPath = placeholder.getAttribute("client-component");

      if (componentPath) {
        try {
          console.log(`Loading client component from: ${componentPath}`);

          // Dynamically import the client component module
          const module = await import(componentPath);
          const componentInstance = new module.default();

          // Transfer any attributes from placeholder to component instance
          Array.from(placeholder.attributes).forEach((attr) => {
            if (attr.name !== "client-component") {
              componentInstance.setAttribute(attr.name, attr.value);
            }
          });

          // Preserve and move children from the placeholder to the component instance
          while (placeholder.firstChild) {
            componentInstance.appendChild(placeholder.firstChild);
          }

          // Replace the placeholder with the actual component
          placeholder.replaceWith(componentInstance);
        } catch (error) {
          console.error(
            `Error loading client component from ${componentPath}:`,
            error
          );
        }
      }
    });
}

// Initialize client-only components when the DOM content is loaded
document.addEventListener("DOMContentLoaded", loadClientComponents);

///////////////////////////////////////////////////////////////////////////////

// Function to fetch and inject page content into the correct layout's <slot>
async function loadPageContentForLayout(path, clickedLink) {
  try {
    // Append "no-layout" query parameter to the path
    const url = new URL(path, window.location.origin);
    url.searchParams.set("no-layout", "true");

    // Determine the layout associated with the clicked link
    let layoutElement = clickedLink.closest("*:has(slot)");
    let clickedLayoutPath = "";

    if (!layoutElement) {
      // Fallback to a global search for any element with a <slot>
      layoutElement = Array.from(document.body.children).find((el) =>
        el.querySelector("slot")
      );
    }

    if (layoutElement) {
      // Dynamically infer the URL of the layout by using the element's script URL
      const scriptElement = Array.from(
        document.querySelectorAll("script")
      ).find((script) => script.src && script.src.includes("/layout.js"));

      if (scriptElement) {
        // Use the script URL to determine the layout path
        clickedLayoutPath = new URL(scriptElement.src).pathname;
      }
    }

    // Add the inferred "clicked-layout" to the URL if found
    if (clickedLayoutPath) {
      url.searchParams.set("clicked-layout", clickedLayoutPath);
    }

    // Fetch the content of the clicked page
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Page not found");
    const html = await response.text();

    // Parse the fetched HTML and extract the content
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;
    const newContentNodes = Array.from(tempDiv.childNodes);

    if (layoutElement) {
      const slotElement = layoutElement.querySelector("slot");

      if (slotElement) {
        // Clear the existing content of the slot
        slotElement.innerHTML = "";

        // Replace the slot content with the new content nodes
        newContentNodes.forEach((node) => {
          slotElement.appendChild(node);
        });
        console.log(`Replaced content for path: ${path}`);

        // Reinitialize any scripts or event listeners for the new content
        reinitializeScripts();
      } else {
        console.warn("Slot element not found or content nodes are empty.");
      }
    } else {
      console.warn("No layout element found with a <slot>.");
    }
  } catch (error) {
    console.error("Failed to load page content:", error);
  }
}

// Intercept link clicks for client-side navigation, only for <a> tags with data-link attribute
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (link && link.getAttribute("href") && !link.getAttribute("target")) {
    event.preventDefault();
    const path = link.getAttribute("href");

    // Use history API to change the URL
    history.pushState({}, "", path);

    // Load the page content into the appropriate layout
    loadPageContentForLayout(path, link);
  }
});

// Handle back/forward navigation using the browser history
window.addEventListener("popstate", () => {
  loadPageContentForLayout(location.pathname, document.body);
});

// Reinitialize any scripts or listeners as needed for the new content
function reinitializeScripts() {
  console.log("Reinitializing client-side scripts...");
  // Add custom initialization logic here
  loadClientComponents();
}

// Load initial page content
loadPageContentForLayout(location.pathname, document.body);
