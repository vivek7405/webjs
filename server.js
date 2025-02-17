import { serve } from "https://deno.land/std@0.201.0/http/server.ts";
import { renderToString } from "npm:wc-compiler";
import { html } from "./utils/html-literal.js";
import { walk } from "https://deno.land/std@0.201.0/fs/walk.ts";
import { posix } from "https://deno.land/std@0.201.0/path/mod.ts"; // Use posix for consistent path handling

// New helper function to match dynamic routes
function matchDynamicRoute(pathname, routePath) {
  const pathnameSegments = pathname.split('/').filter(Boolean);
  const routeSegments = routePath.split('/').filter(Boolean);

  if (pathnameSegments.length !== routeSegments.length) return null;

  const params = {};

  for (let i = 0; i < routeSegments.length; i++) {
    const routeSegment = routeSegments[i];
    const pathnameSegment = pathnameSegments[i];

    if (routeSegment.startsWith('[') && routeSegment.endsWith(']')) {
      const paramName = routeSegment.slice(1, -1);
      params[paramName] = pathnameSegment;
    } else if (routeSegment !== pathnameSegment) {
      return null;
    }
  }

  return params;
}

// Modified generateRoutes function
async function generateRoutes() {
  const routes = new Map();

  for await (const entry of walk("./app", { includeDirs: false })) {
    if (entry.name === "page.js") {
      let routePath = posix.normalize(
        entry.path.replace(/^app/, "").replace(/\/page\.js$/, "")
      );

      if (routePath === "" || routePath === ".") {
        routePath = "/";
      }

      routes.set(routePath, entry.path);
      console.log(`Route added: ${routePath} -> ${entry.path}`);
    }
  }
  return routes;
}

// Modified renderComponent function
async function renderComponent(componentPath, params = {}) {
  try {
    const module = await import(new URL(componentPath, import.meta.url));
    const Component = module.default;
    const instance = new Component();

    // Inject route params into the component
    instance.params = params;

    await instance.connectedCallback?.();
    return instance.innerHTML || '';
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
  params
) {
  // Start with the innermost content, which is the main page component
  let content = await renderComponent(componentPath, params);

  // Get applicable layouts for the route, from outermost to innermost
  const layouts = await getLayoutPaths(pathname, noLayout);

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
      } else {
        layouts = [];
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

  if (pathname.match(/\.[a-zA-Z0-9]+$/)) {
    return await serveStaticFile(pathname);
  }

  // Find matching route including dynamic routes
  let matchedPath;
  let params = {};

  for (const [routePath] of routes) {
    const dynamicParams = matchDynamicRoute(pathname, routePath);
    if (dynamicParams) {
      matchedPath = routePath;
      params = dynamicParams;
      break;
    } else if (routePath === pathname) {
      matchedPath = routePath;
      break;
    }
  }

  const componentPath = routes.get(matchedPath);
  if (!componentPath) {
    return new Response("404 - Not Found", { status: 404 });
  }

  try {
    console.log(`Rendering full page: ${componentPath}`);
    const renderedContent = await renderWithLayouts(
      pathname,
      componentPath,
      noLayout,
      params
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
