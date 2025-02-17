import { serve } from "https://deno.land/std@0.201.0/http/server.ts";
import { renderToString } from "npm:wc-compiler";
import { html } from "./utils/html-literal.js";
import { walk } from "https://deno.land/std@0.201.0/fs/walk.ts";
import { posix } from "https://deno.land/std@0.201.0/path/mod.ts"; // Use posix for consistent path handling

// Dynamically generate routes from the `app` folder
async function generateRoutes() {
  const routes = {};

  for await (const entry of walk("./app", { includeDirs: false })) {
    if (entry.name === "page.js") {
      // Generate route paths from file structure
      let routePath = posix.normalize(
        entry.path.replace(/^app/, "").replace(/\/page\.js$/, "")
      ); // Normalize path to handle slashes correctly

      // Map root index page to "/"
      if (routePath === "" || routePath === ".") {
        routePath = "/";
      }

      routes[routePath] = entry.path;
      console.log(`Route added: ${routePath} -> ${entry.path}`);
    }
  }
  return routes;
}

// Render components and handle missing files
async function renderComponent(componentPath) {
  try {
    const { html: renderedContent } = await renderToString(
      new URL(componentPath, import.meta.url)
    );
    return renderedContent;
  } catch (error) {
    console.error(`Error rendering component: ${componentPath}`, error);
    return `<div>Error loading component ${componentPath}</div>`;
  }
}

// Function to render a page, optionally with layouts
async function renderWithLayouts(
  pathname,
  componentPath,
  noLayout,
) {
  // Start with the innermost content, which is the main page component
  let content = await renderComponent(componentPath);

  // Get applicable layouts for the route, from outermost to innermost
  const layouts = await getLayoutPaths(pathname, noLayout);

  // // If "no-layout" query parameter is present, exclude the clicked layout
  // if (noLayout) {
  //   // Filter out parent layouts that have pages
  //   const filteredLayouts = layouts.filter((layoutPath) => {
  //     const layoutDir = posix.dirname(layoutPath);
  //     const pagePath = posix.join(layoutDir, 'page.js');
  //     try {
  //       Deno.statSync(pagePath);
  //       return false; // Skip this layout if a page exists in the same directory
  //     } catch {
  //       return true; // Keep this layout if no page exists
  //     }
  //   });

  //   // Apply the remaining layouts in the correct order
  //   for (let i = filteredLayouts.length - 1; i >= 0; i--) {
  //     const layoutPath = filteredLayouts[i];
  //     const layoutContent = await renderComponent(layoutPath);
  //     if (!layoutContent.includes("<slot>")) {
  //       console.warn(`Layout ${layoutPath} missing <slot> placeholder.`);
  //     }
  //     content = layoutContent.replace("<slot>", `<slot>${content}`);
  //   }

  //   return content;
  // }

  // If noLayout is false, apply all layouts as usual
  for (let i = layouts.length - 1; i >= 0; i--) {
    const layoutPath = layouts[i];
    const layoutContent = await renderComponent(layoutPath);
    if (!layoutContent.includes("<slot>")) {
      console.warn(`Layout ${layoutPath} missing <slot> placeholder.`);
    }
    content = layoutContent.replace("<slot>", `<slot>${content}`);
  }

  return content;
}

// Helper function to find all applicable layouts for a given route path
async function getLayoutPaths(pathname, noLayout) {
  const segments = pathname.split("/").filter(Boolean);
  let layouts = [];
  const uniquePaths = new Set();

  // Traverse from either root or pathname to innermost directory
  for (let i = 0; i <= segments.length; i++) {
    const layoutPath = posix.normalize(
      `./app/${segments.slice(0, i).join("/")}/layout.js`
    );
    console.log(`Layout path for segment ${segments[i]} index ${i}: ${layoutPath}`);

    // Check if layout exists and ensure uniqueness
    try {
      await Deno.stat(layoutPath); // Ensure the file exists
      if (!uniquePaths.has(layoutPath)) {
        uniquePaths.add(layoutPath);
        layouts.push(layoutPath); // Add layout in order from outermost to innermost
      }
    } catch {
      // Skip if layout does not exist
    }
  }

  if (noLayout) {
    try {
      const pathToInclude = segments && segments.length > 0 ? `/${segments[segments.length - 1]}` : null;
      console.log(`Path to include: ${pathToInclude}`);
      if (pathToInclude) {
        layouts = layouts.filter(layout => layout.includes(pathToInclude));
      }
    } catch (error) {
      console.error(`Error filtering layouts for noLayout ${noLayout}:`, error);
    }
  }

  console.log(`Layouts for ${pathname} for noLayout ${noLayout}:`, layouts);
  return layouts; // No need to reverse; order is correct
}

// Serve static files with correct MIME types
async function serveStaticFile(pathname) {
  const filePath = `.${pathname}`;

  try {
    const file = await Deno.readFile(filePath);
    const ext = filePath.split(".").pop().toLowerCase();
    const contentType =
      ext === "js"
        ? "application/javascript"
        : ext === "css"
          ? "text/css"
          : ext === "html"
            ? "text/html"
            : "text/plain";

    console.log(`Serving ${filePath} with Content-Type: ${contentType}`);
    return new Response(file, { headers: { "content-type": contentType } });
  } catch (error) {
    console.error(`Error serving static file ${filePath}:`, error);
    return new Response("File not found", { status: 404 });
  }
}

// Load routes once at server startup
const routes = await generateRoutes();

// Main server handler for SSR pages
serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const noLayout = url.searchParams.has("no-layout");
  // const clickedLayoutPath = url.searchParams.get("clicked-layout");

  // Serve static files if the path has a file extension (e.g., .js, .css)
  if (pathname.match(/\.[a-zA-Z0-9]+$/)) {
    return await serveStaticFile(pathname);
  }

  // Handle dynamic routes
  const componentPath = routes[pathname];
  if (!componentPath) {
    return new Response("404 - Not Found", { status: 404 });
  }

  try {
    console.log(`Rendering full page: ${componentPath}`);
    const renderedContent = await renderWithLayouts(
      pathname,
      componentPath,
      noLayout,
    );

    return new Response(
      html`<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1.0"
            />
            <title>Deno App Router</title>
            <link rel="stylesheet" href="/static/styles.css" />
          </head>
          <body>
            ${renderedContent}
            <script type="module" src="/static/client.js"></script>
          </body>
        </html>`,
      { headers: { "content-type": "text/html" } }
    );
  } catch (error) {
    console.error(`Error rendering ${componentPath}:`, error);
    return new Response("500 - Internal Server Error", { status: 500 });
  }
});

console.log("Server running on http://localhost:8000");
