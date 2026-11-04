import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the 3D coffee view into one self-contained HTML file (dist/app.html).
// The same file is served as the MCP App resource and as the landing page.
export default defineConfig({
  root: "app",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    rollupOptions: { input: "app/app.html" },
  },
});
