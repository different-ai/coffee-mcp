import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // Mirror Wrangler's "Text" rule: importing an .html file yields its contents.
      name: "html-as-text",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".html")) {
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
        }
        return null;
      },
    },
  ],
  test: { include: ["test/**/*.test.ts"] },
});
